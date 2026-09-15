import { Injectable, OnModuleInit } from '@nestjs/common';

import { VisitsService } from '../services/visits.service';
import { VisitStatus } from '../enums/visit-status.enum';

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
 * Qué se ve cuando llega "Tienes una visita en portería".
 *
 * Aquí la foto no es un lujo: el residente está autorizando la entrada de
 * alguien a su casa y la portería capturó la cara en ese momento. Aprobar sin
 * verla —o sin ver el documento— es aprobar a ciegas, y es exactamente el
 * momento en el que se cuela quien no debía entrar.
 */

const TYPE: Record<string, string> = {
  WALK_IN: 'Sin cita previa',
  SCHEDULED: 'Programada con QR',
  DELIVERY: 'Domicilio',
  SERVICE_PROVIDER: 'Servicio técnico',
};

const STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [VisitStatus.PENDING_APPROVAL]: {
    label: 'Esperando tu respuesta',
    tone: NotificationSnapshotTone.WARNING,
  },
  [VisitStatus.APPROVED]: {
    label: 'Autorizada',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [VisitStatus.DENIED]: {
    label: 'Rechazada',
    tone: NotificationSnapshotTone.DANGER,
  },
  [VisitStatus.INSIDE]: {
    label: 'Dentro del complejo',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [VisitStatus.COMPLETED]: {
    label: 'Visita finalizada',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [VisitStatus.CANCELLED]: {
    label: 'Cancelada',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [VisitStatus.EXPIRED]: {
    label: 'Vencida',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [VisitStatus.NO_SHOW]: {
    label: 'No se presentó',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
};

@Injectable()
export class VisitsNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = ['visit', 'visitor', 'visitor_vehicle'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly visitsService: VisitsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    // Los avisos de visitante y de vehículo del visitante apuntan a la visita:
    // es el evento que se está autorizando, y la persona sola no se decide.
    const visit = await this.visitsService.findById(
      notification.entityId,
      currentUser,
    );

    const status = STATUS[visit.status] ?? {
      label: String(visit.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    const visitor = visit.visitor;
    const visitorName = visitor
      ? `${visitor.name ?? ''} ${visitor.lastName ?? ''}`.trim()
      : null;

    return snapshot({
      entityType: 'visit',
      entityId: visit.id,
      statusCode: visit.status,
      headline: [visitorName, TYPE[visit.type] ?? visit.type]
        .filter(Boolean)
        .join(' · '),
      statusLabel: status.label,
      statusTone: status.tone,
      sections: [
        section('Quién viene', [
          field('Nombre', visitorName),
          field(
            'Documento',
            visitor
              ? [visitor.identityType, visitor.identity]
                  .filter(Boolean)
                  .join(' ')
              : null,
          ),
          field(
            'Teléfono',
            visitor?.phone,
            NotificationFieldKind.PHONE,
            visitor?.phone ? `tel:${visitor.phone}` : null,
          ),
          // Si el visitante está en lista negra, eso manda sobre todo lo demás.
          field(
            'Lista negra',
            visitor?.isBlacklisted
              ? (visitor.blacklistReason ?? 'Bloqueado')
              : null,
            NotificationFieldKind.BADGE,
          ),
        ]),
        section('La visita', [
          field('Motivo', visit.purpose, NotificationFieldKind.MULTILINE),
          field('Tipo', TYPE[visit.type] ?? visit.type),
          field('Unidad', unitLabel(visit.unit)),
          field('Placa', visit.vehiclePlate, NotificationFieldKind.BADGE),
          field(
            'Llegada esperada',
            visit.expectedArrivalAt,
            NotificationFieldKind.DATE,
          ),
          field('Entró', visit.entryTime, NotificationFieldKind.DATE),
          field('Salió', visit.exitTime, NotificationFieldKind.DATE),
        ]),
        section('Trámite', [
          field('Estado', status.label, NotificationFieldKind.BADGE),
          field(
            'Aprobada',
            visit.approvedByResidentAt,
            NotificationFieldKind.DATE,
          ),
          field(
            'Rechazada',
            visit.deniedByResidentAt,
            NotificationFieldKind.DATE,
          ),
          field(
            'Motivo del rechazo',
            visit.denialReason,
            NotificationFieldKind.MULTILINE,
          ),
          field(
            'Notas de portería',
            visit.notes,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
      ],
      images: [image(visitor?.photoUrl, visitorName ?? 'Visitante')],
      source: NotificationSnapshotSource.LIVE,
    });
  }
}
