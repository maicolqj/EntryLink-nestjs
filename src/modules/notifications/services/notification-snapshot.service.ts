import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { Notification } from '../entities/notification.entity';
import { NotificationDetailRegistry } from './notification-detail.registry';
import {
  NotificationEntitySnapshot,
  NotificationFieldKind,
  NotificationSnapshotImage,
  NotificationSnapshotFile,
  NotificationSnapshotSource,
} from '../dto/responses/notification-snapshot.response';
import {
  METADATA_LABELS,
  field,
  file,
  humanizeKey,
  image,
  isFileUrl,
  isImageUrl,
  isTechnicalKey,
  kindForValue,
  section,
  snapshot,
} from '../utils/notification-snapshot.util';
import { NotificationSnapshotAction } from '../dto/responses/notification-action.response';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import { NotificationActionErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Arma el expediente de una notificación: primero le pregunta al módulo dueño
 * del asunto; si no hay quien responda, muestra lo que quedó en `metadata`.
 *
 * La caída a `metadata` no es un parche: una notificación de hace seis meses
 * puede apuntar a una ficha que ya se eliminó, y en ese caso lo único honesto
 * que se puede mostrar es lo que se guardó ese día. Por eso el expediente dice
 * siempre de dónde salió lo que se ve (`source`).
 */
@Injectable()
export class NotificationSnapshotService {
  private readonly logger = new Logger(NotificationSnapshotService.name);

  constructor(private readonly registry: NotificationDetailRegistry) {}

  async build(
    notification: Notification,
    currentUser: JwtAccessPayload,
  ): Promise<NotificationEntitySnapshot> {
    const provider = this.registry.resolve(notification.entityType);

    if (provider) {
      try {
        const built = await provider.build({ notification, currentUser });
        if (built) return built;
      } catch (err) {
        // El expediente es un complemento: si falla, el aviso tiene que seguir
        // abriéndose. Perder el detalle es molesto; perder la notificación
        // entera es que el administrador no se entera de nada.
        const error = err as Error;
        this.logger.warn(
          `No se pudo armar el expediente de ${notification.entityType}/${notification.entityId}: ${error?.message}`,
        );
      }
    }

    return this.fromMetadata(notification);
  }

  /**
   * Ejecuta una acción del expediente y devuelve el expediente ya actualizado.
   *
   * Lo que llega de la web es un código y unos valores, NUNCA una autorización:
   * las acciones se vuelven a armar aquí con el estado de HOY y se comprueba
   * que la pedida siga estando y siga habilitada. Entre que el administrador
   * abrió el aviso y pulsó el botón pudo pasar de todo —otro administrador
   * resolvió el caso, la unidad presentó descargos— y el trámite no puede
   * depender de lo que la pantalla tenga pintado.
   *
   * Devolver el expediente nuevo (y no un booleano) es lo que deja el modal
   * mostrando el estado real sin una segunda consulta.
   */
  async execute(
    notification: Notification,
    currentUser: JwtAccessPayload,
    actionCode: string,
    values: Record<string, unknown>,
  ): Promise<NotificationEntitySnapshot> {
    const provider = this.registry.resolve(notification.entityType);

    if (!provider?.execute) {
      throw new CustomError({
        message: 'Este aviso no admite acciones',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: NotificationActionErrorCode.NOTIFICATION_ACTION_UNSUPPORTED,
      });
    }

    const current = await provider.build({ notification, currentUser });
    const declared = current?.actions?.find((a) => a.code === actionCode);

    if (!declared) {
      throw new CustomError({
        message: 'La acción ya no está disponible para este aviso',
        statusCode: HttpStatus.CONFLICT,
        errorCode: NotificationActionErrorCode.NOTIFICATION_ACTION_UNAVAILABLE,
      });
    }

    if (!declared.isEnabled) {
      throw new CustomError({
        message: declared.disabledReason ?? 'La acción no está disponible',
        statusCode: HttpStatus.CONFLICT,
        errorCode: NotificationActionErrorCode.NOTIFICATION_ACTION_BLOCKED,
      });
    }

    this.assertRequiredValues(declared, values);

    await provider.execute({
      notification,
      currentUser,
      actionCode,
      values,
    });

    this.logger.log(
      `Acción ${actionCode} ejecutada sobre ${notification.entityType}/${notification.entityId} por ${currentUser.sub}`,
    );

    return this.build(notification, currentUser);
  }

  /**
   * Los obligatorios se comprueban con lo que el propio módulo declaró, no con
   * una lista aparte: así el día que una acción pide un campo más, no hay dos
   * sitios que actualizar y quedar desincronizados.
   */
  private assertRequiredValues(
    declared: NotificationSnapshotAction,
    values: Record<string, unknown>,
  ): void {
    for (const fieldSpec of declared.fields) {
      if (!fieldSpec.required) continue;

      const value = values[fieldSpec.name];
      const isEmpty =
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '');

      if (isEmpty) {
        throw new CustomError({
          message: `Falta ${fieldSpec.label.toLowerCase()}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode:
            NotificationActionErrorCode.NOTIFICATION_ACTION_FIELD_REQUIRED,
        });
      }
    }
  }

  /**
   * Lo que se puede contar sin conocer el dominio: cada clave de `metadata` con
   * su nombre en palabras, y todo lo que tenga forma de imagen o de archivo
   * mostrado como tal.
   *
   * Es el piso mínimo, y es lo que hace que un módulo que todavía no registró
   * su proveedor no se vea vacío.
   */
  private fromMetadata(notification: Notification): NotificationEntitySnapshot {
    const metadata = this.parseMetadata(notification.metadata);
    const images: (NotificationSnapshotImage | null)[] = [];
    const files: (NotificationSnapshotFile | null)[] = [];
    const fields = [];

    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined || value === '') continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (isImageUrl(item)) images.push(image(item, null));
          else if (isFileUrl(item)) files.push(file(item, humanizeKey(key)));
        }
        continue;
      }

      if (isImageUrl(value)) {
        images.push(image(value, METADATA_LABELS[key] ?? null));
        continue;
      }

      if (isFileUrl(value)) {
        files.push(file(value, METADATA_LABELS[key] ?? humanizeKey(key)));
        continue;
      }

      if (isTechnicalKey(key, value)) continue;
      if (typeof value === 'object') continue;

      fields.push(
        field(
          METADATA_LABELS[key] ?? humanizeKey(key),
          value,
          kindForValue(key, value),
        ),
      );
    }

    // Unas coordenadas sueltas no se leen; un enlace al mapa sí se abre.
    const lat = metadata.requestLat ?? metadata.lat;
    const lng = metadata.requestLng ?? metadata.lng;
    if (lat != null && lng != null) {
      fields.push(
        field(
          'Ubicación',
          `${lat}, ${lng}`,
          NotificationFieldKind.LOCATION,
          `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
        ),
      );
    }

    return snapshot({
      entityType: notification.entityType,
      entityId: notification.entityId,
      sections: [section('Datos del aviso', fields)],
      images,
      files,
      source: NotificationSnapshotSource.METADATA,
      isMissing: false,
    });
  }

  private parseMetadata(raw: unknown): Record<string, any> {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as Record<string, any>;
      } catch {
        return {};
      }
    }
    return raw as Record<string, any>;
  }
}
