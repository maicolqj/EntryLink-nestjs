import { Injectable, OnModuleInit } from '@nestjs/common';

import { PqrfService } from '../services/pqrf.service';
import { PqrfStatus } from '../enums/pqrf-status.enum';

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
  section,
  snapshot,
  unitLabel,
} from '../../notifications/utils/notification-snapshot.util';

/**
 * Qué se ve cuando llega un aviso de PQRF.
 *
 * Lo que decide el trámite es el plazo: un radicado tiene fecha de vencimiento y
 * vencerlo sin responder lo resuelve por silencio administrativo positivo —a
 * favor de quien radicó—. Por eso el vencimiento va en el expediente y no
 * escondido en otra pantalla.
 *
 * El control de acceso lo hace el servicio del módulo (`assertCanRead`): un
 * radicado dirigido solo al consejo no se le muestra a la administración, y ese
 * criterio no se puede duplicar aquí sin arriesgarse a que se desincronice.
 */

const TYPE: Record<string, string> = {
  PETICION: 'Petición',
  QUEJA: 'Queja',
  RECLAMO: 'Reclamo',
  SUGERENCIA: 'Sugerencia',
  FELICITACION: 'Felicitación',
};

const ADDRESSEE: Record<string, string> = {
  ADMINISTRACION: 'Administración',
  CONSEJO: 'Consejo de administración',
  AMBOS: 'Administración y consejo',
};

const STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [PqrfStatus.RADICADO]: {
    label: 'Radicado',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PqrfStatus.EN_TRAMITE]: {
    label: 'En trámite',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PqrfStatus.RESUELTO]: {
    label: 'Resuelto',
    tone: NotificationSnapshotTone.POSITIVE,
  },
};

@Injectable()
export class PqrfNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = ['pqrf'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly pqrfService: PqrfService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    const pqrf = await this.pqrfService.findById(
      notification.entityId,
      currentUser,
    );

    const status = STATUS[pqrf.status] ?? {
      label: String(pqrf.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    const overdue =
      pqrf.status !== PqrfStatus.RESUELTO &&
      !!pqrf.dueAt &&
      new Date(pqrf.dueAt) < new Date();

    return snapshot({
      entityType: 'pqrf',
      entityId: pqrf.id,
      statusCode: pqrf.status,
      headline: `${pqrf.code} · ${TYPE[pqrf.type] ?? pqrf.type}`,
      statusLabel: overdue ? 'Plazo vencido' : status.label,
      statusTone: overdue ? NotificationSnapshotTone.DANGER : status.tone,
      sections: [
        section('El radicado', [
          field('Asunto', pqrf.subject),
          field('Tipo', TYPE[pqrf.type] ?? pqrf.type),
          field('Dirigido a', ADDRESSEE[pqrf.addressee] ?? pqrf.addressee),
          field(
            'Descripción',
            pqrf.description,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
        section('Quién radica', [
          field('Residente', pqrf.requestedByName),
          field('Unidad', unitLabel(pqrf.unit)),
          field('Radicado', pqrf.createdAt, NotificationFieldKind.DATE),
        ]),
        section('Trámite', [
          field('Estado', status.label, NotificationFieldKind.BADGE),
          field(
            overdue ? 'Venció' : 'Vence',
            pqrf.dueAt,
            NotificationFieldKind.DATE,
          ),
          field('Resuelto', pqrf.resolvedAt, NotificationFieldKind.DATE),
          field(
            'Resuelto por silencio administrativo',
            pqrf.resolvedBySilence ? 'Sí' : null,
            NotificationFieldKind.BADGE,
          ),
        ]),
      ],
      source: NotificationSnapshotSource.LIVE,
    });
  }
}
