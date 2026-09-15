import { Injectable, OnModuleInit } from '@nestjs/common';

import { PackagesService } from '../services/packages.service';
import { PackageStatus } from '../enums/package-status.enum';

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
  unitLabel,
} from '../../notifications/utils/notification-snapshot.util';

/**
 * Qué se ve cuando llega "Tienes un paquete en portería".
 *
 * La foto es el dato que evita el reclamo: el residente reconoce su caja antes
 * de bajar, y si la que aparece no es la suya se sabe de una vez. Lo demás
 * —remitente, guía, quién lo recibió, hasta cuándo lo guardan— es lo que la
 * portería tendría que estar contestando por teléfono.
 */

const TYPE: Record<string, string> = {
  PARCEL: 'Paquete',
  ENVELOPE: 'Sobre',
  FOOD: 'Domicilio de comida',
  FRAGILE: 'Frágil',
  DOCUMENT: 'Documentos',
  OTHER: 'Otro',
};

const STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [PackageStatus.RECEIVED]: {
    label: 'Recibido en portería',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PackageStatus.NOTIFIED]: {
    label: 'Pendiente de retiro',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PackageStatus.READY_FOR_PICKUP]: {
    label: 'Listo para recoger',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PackageStatus.DELIVERED]: {
    label: 'Entregado',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [PackageStatus.RETURNED]: {
    label: 'Devuelto al remitente',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [PackageStatus.LOST]: {
    label: 'Reportado como perdido',
    tone: NotificationSnapshotTone.DANGER,
  },
};

@Injectable()
export class PackagesNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = ['package'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly packagesService: PackagesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    const pkg = await this.packagesService.findById(
      notification.entityId,
      currentUser,
    );

    const status = STATUS[pkg.status] ?? {
      label: String(pkg.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    return snapshot({
      entityType: 'package',
      entityId: pkg.id,
      statusCode: pkg.status,
      headline: [TYPE[pkg.type] ?? pkg.type, pkg.senderName]
        .filter(Boolean)
        .join(' · '),
      statusLabel: status.label,
      statusTone: status.tone,
      sections: [
        section('El envío', [
          field('Tipo', TYPE[pkg.type] ?? pkg.type),
          field('Remitente', pkg.senderName),
          field('Guía', pkg.trackingCode),
          field(
            'Descripción',
            pkg.description,
            NotificationFieldKind.MULTILINE,
          ),
          field('Para', pkg.recipientName),
          field('Unidad', unitLabel(pkg.unit)),
        ]),
        section('Custodia', [
          field('Recibido', pkg.receivedAt, NotificationFieldKind.DATE),
          field('Lo recibió', pkg.receivedByName),
          field('Avisado', pkg.notifiedAt, NotificationFieldKind.DATE),
          field(
            'Días de guarda',
            pkg.maxStorageDays ? `${pkg.maxStorageDays}` : null,
          ),
          field('Entregado', pkg.deliveredAt, NotificationFieldKind.DATE),
          field('Devuelto', pkg.returnedAt, NotificationFieldKind.DATE),
          field(
            'Motivo de la devolución',
            pkg.returnReason,
            NotificationFieldKind.MULTILINE,
          ),
          field('Notas', pkg.notes, NotificationFieldKind.MULTILINE),
        ]),
      ],
      images: [image(pkg.photoUrl, 'Paquete en portería')],
      source: NotificationSnapshotSource.LIVE,
    });
  }
}
