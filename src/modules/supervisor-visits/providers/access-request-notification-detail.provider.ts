import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupervisorAccessRequest } from '../entities/supervisor-access-request.entity';
import { AccessRequestStatus } from '../enums/access-request-status.enum';

import { NotificationDetailRegistry } from '../../notifications/services/notification-detail.registry';
import {
  NotificationDetailProvider,
  NotificationSnapshotContext,
} from '../../notifications/interfaces/notification-detail-provider.interface';
import {
  NotificationEntitySnapshot,
  NotificationFieldKind,
  NotificationSnapshotSource,
  NotificationSnapshotTone,
} from '../../notifications/dto/responses/notification-snapshot.response';
import {
  field,
  image,
  section,
  snapshot,
} from '../../notifications/utils/notification-snapshot.util';

/**
 * Qué se ve cuando llega "Nueva solicitud de acceso".
 *
 * Quien autoriza está dejando entrar a una persona al conjunto, y el aviso solo
 * decía el nombre. Aquí van la foto del supervisor, su documento, desde dónde
 * pidió el acceso y —esto es lo que evita el error caro— el estado de HOY: si
 * otro administrador ya la resolvió hace media hora, el botón de aprobar no
 * tiene por qué seguir invitando a aprobarla.
 */

const STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [AccessRequestStatus.PENDING]: {
    label: 'Pendiente de autorización',
    tone: NotificationSnapshotTone.WARNING,
  },
  [AccessRequestStatus.APPROVED]: {
    label: 'Aprobada',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [AccessRequestStatus.REJECTED]: {
    label: 'Rechazada',
    tone: NotificationSnapshotTone.DANGER,
  },
};

@Injectable()
export class AccessRequestNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = ['ACCESS_REQUEST'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    @InjectRepository(SupervisorAccessRequest)
    private readonly requestRepo: Repository<SupervisorAccessRequest>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    // El aviso de aprobación/rechazo guarda el id en metadata; el de la
    // solicitud nueva lo trae en entityId. Los dos apuntan a lo mismo.
    const metadata = this.parseMetadata(notification.metadata);
    const requestId =
      notification.entityId ?? (metadata.requestId as string | undefined);
    if (!requestId) return null;

    const request = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['supervisor', 'resolvedBy'],
    });

    // Quien abre el aviso ya pasó el control de acceso de la notificación; lo
    // que falta verificar es que la solicitud sea de ESE complejo y no de otro
    // al que la notificación no pertenece.
    if (!request || request.complexId !== notification.complexId) return null;

    const status = STATUS[request.status] ?? {
      label: String(request.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    const supervisor = request.supervisor;
    const supervisorName = supervisor
      ? `${supervisor.name ?? ''} ${supervisor.lastName ?? ''}`.trim()
      : ((metadata.supervisorName as string | undefined) ?? null);

    const lat = request.requestLat ?? (metadata.requestLat as number | null);
    const lng = request.requestLng ?? (metadata.requestLng as number | null);

    const resolvedByName = request.resolvedBy
      ? `${request.resolvedBy.name ?? ''} ${request.resolvedBy.lastName ?? ''}`.trim()
      : null;

    return snapshot({
      entityType: 'ACCESS_REQUEST',
      entityId: request.id,
      statusCode: request.status,
      headline: supervisorName,
      statusLabel: status.label,
      statusTone: status.tone,
      sections: [
        section('Quién pide entrar', [
          field('Nombre', supervisorName),
          field('Documento', supervisor?.identity),
          field(
            'Teléfono',
            supervisor?.phoneNumber,
            NotificationFieldKind.PHONE,
            supervisor?.phoneNumber ? `tel:${supervisor.phoneNumber}` : null,
          ),
          field('Correo', supervisor?.email),
        ]),
        section('La solicitud', [
          field(
            'Mensaje',
            request.message,
            NotificationFieldKind.MULTILINE,
          ),
          field('Solicitada', request.createdAt, NotificationFieldKind.DATE),
          lat != null && lng != null
            ? field(
                'Desde dónde la pidió',
                `${lat}, ${lng}`,
                NotificationFieldKind.LOCATION,
                `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
              )
            : null,
        ]),
        section('Trámite', [
          field('Estado', status.label, NotificationFieldKind.BADGE),
          field('Resuelta por', resolvedByName),
          field('Resuelta', request.resolvedAt, NotificationFieldKind.DATE),
          field(
            'Motivo del rechazo',
            request.rejectionReason,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
      ],
      // La foto del perfil es la que permite reconocer en portería a quien se
      // está autorizando: es parte de la decisión, no un adorno.
      images: [image(supervisor?.profilePicture, supervisorName)],
      source: NotificationSnapshotSource.LIVE,
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
