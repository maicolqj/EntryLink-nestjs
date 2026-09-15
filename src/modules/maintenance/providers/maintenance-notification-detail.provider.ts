import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';

import { MaintenanceTicketsService } from '../services/maintenance-tickets.service';
import { MaintenanceTicket } from '../entities/maintenance-ticket.entity';
import { MaintenanceTicketStatus } from '../enums/maintenance-ticket-status.enum';
import { MaintenanceCategory } from '../enums/maintenance-category.enum';
import { MaintenancePriority } from '../enums/maintenance-priority.enum';
import { MaintenanceTicketStatus as Status } from '../enums/maintenance-ticket-status.enum';

import { NotificationDetailRegistry } from '../../notifications/services/notification-detail.registry';
import {
  NotificationActionContext,
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
  NotificationActionFieldKind,
  NotificationActionTone,
  NotificationSnapshotAction,
} from '../../notifications/dto/responses/notification-action.response';
import {
  action,
  actionField,
  field,
  file,
  image,
  section,
  snapshot,
  unitLabel,
} from '../../notifications/utils/notification-snapshot.util';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';

const CATEGORY: Record<string, string> = {
  [MaintenanceCategory.ILUMINACION]: 'Iluminación',
  [MaintenanceCategory.ELECTRICO]: 'Eléctrico',
  [MaintenanceCategory.PLOMERIA]: 'Plomería',
  [MaintenanceCategory.ESTRUCTURA]: 'Estructura',
  [MaintenanceCategory.ASCENSORES]: 'Ascensores',
  [MaintenanceCategory.PUERTAS_Y_ACCESOS]: 'Puertas y accesos',
  [MaintenanceCategory.SEGURIDAD]: 'Seguridad',
  [MaintenanceCategory.ASEO]: 'Aseo',
  [MaintenanceCategory.JARDINERIA]: 'Jardinería',
  [MaintenanceCategory.PISCINA]: 'Piscina',
  [MaintenanceCategory.GAS]: 'Gas',
  [MaintenanceCategory.OTRO]: 'Otro',
};

const LOCATION_TYPE: Record<string, string> = {
  GPS: 'GPS del dispositivo',
  TAG: 'Escaneando el punto señalizado',
  TREE: 'Señalando torre y piso',
  AMENITY: 'Eligiendo la zona común',
};

const PRIORITY: Record<string, string> = {
  [MaintenancePriority.LOW]: 'Baja',
  [MaintenancePriority.MEDIUM]: 'Media',
  [MaintenancePriority.HIGH]: 'Alta',
  [MaintenancePriority.CRITICAL]: 'Crítica',
};

const STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [Status.NEW]: {
    label: 'Reporte nuevo',
    tone: NotificationSnapshotTone.WARNING,
  },
  [Status.TRIAGED]: {
    label: 'En revisión',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [Status.ASSIGNED]: {
    label: 'Técnico asignado',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [Status.IN_PROGRESS]: {
    label: 'En reparación',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [Status.ON_HOLD]: {
    label: 'Detenido',
    tone: NotificationSnapshotTone.WARNING,
  },
  [Status.RESOLVED]: {
    label: 'Reparado',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [Status.CLOSED]: {
    label: 'Cerrado',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [Status.REJECTED]: {
    label: 'No procede',
    tone: NotificationSnapshotTone.DANGER,
  },
  [Status.DUPLICATE]: {
    label: 'Ya estaba reportado',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
};

/** Códigos de las acciones que este proveedor ofrece desde el aviso. */
export enum MaintenanceActionCode {
  TICKET_TRIAGE = 'MAINTENANCE_TICKET_TRIAGE',
  TICKET_REJECT = 'MAINTENANCE_TICKET_REJECT',
  TICKET_CLOSE = 'MAINTENANCE_TICKET_CLOSE',
  TICKET_REOPEN = 'MAINTENANCE_TICKET_REOPEN',
  TICKET_RATE = 'MAINTENANCE_TICKET_RATE',
}

const MIN_REASON = 10;

/**
 * Qué se ve cuando se abre un aviso de mantenimiento.
 *
 * "Nuevo reporte MTO-000012" no alcanza para decidir nada: quien revisa
 * necesita la foto, el sitio, la urgencia y hace cuánto está esperando. Eso es
 * lo que arma este proveedor, y por eso las consultas pasan por el SERVICIO y
 * no por el repositorio: así el expediente hereda los mismos permisos que la
 * pantalla y el residente no ve por el aviso lo que no vería en la app.
 */
@Injectable()
export class MaintenanceNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = ['maintenance_ticket', 'maintenanceTicket'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly ticketsService: MaintenanceTicketsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    const ticket = await this.ticketsService.findById(
      notification.entityId,
      currentUser,
    );

    const status = STATUS[ticket.status] ?? {
      label: String(ticket.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    const photos = (ticket.photoUrls ?? []).map((url, index) =>
      image(url, `Daño ${index + 1}`, ticket.photoHashes?.[index] ?? null),
    );

    const closurePhotos = (ticket.closurePhotoUrls ?? []).map((url, index) =>
      image(
        url,
        `Reparación ${index + 1}`,
        ticket.closurePhotoHashes?.[index] ?? null,
      ),
    );

    const coords =
      ticket.lat != null && ticket.lng != null
        ? field(
            'Coordenadas',
            `${ticket.lat}, ${ticket.lng}`,
            NotificationFieldKind.LOCATION,
            `https://www.google.com/maps/search/?api=1&query=${ticket.lat},${ticket.lng}`,
          )
        : null;

    return snapshot({
      entityType: 'maintenance_ticket',
      entityId: ticket.id,
      statusCode: ticket.status,
      headline: `${ticket.code} · ${ticket.title}`,
      statusLabel: status.label,
      statusTone: status.tone,
      sections: [
        section('Qué pasó', [
          field('Tipo', CATEGORY[ticket.category] ?? ticket.category),
          field('Urgencia', PRIORITY[ticket.priority] ?? ticket.priority),
          field(
            'Descripción',
            ticket.description,
            NotificationFieldKind.MULTILINE,
          ),
          field('Ocurrió', ticket.occurredAt, NotificationFieldKind.DATE),
          field('Vecinos que confirman', ticket.endorsementCount || null),
        ]),
        section('Dónde', [
          field('Sitio', this.locationLabel(ticket)),
          field('Torre', ticket.building?.name),
          field('Piso', this.floorLabel(ticket.floor)),
          field('Zona común', ticket.amenity?.name),
          field(
            'Punto señalizado',
            ticket.locationTag
              ? `${ticket.locationTag.name} (${ticket.locationTag.code})`
              : null,
          ),
          // La referencia escrita va aparte del sitio: cuando el residente
          // escaneó un tag o eligió una zona común, "junto al parqueadero 45"
          // se perdía, y es justo lo que le ahorra vueltas al técnico.
          field('Referencia', ticket.locationText),
          // Cómo se fijó el punto: un tag pegado en la pared y un GPS de sótano
          // no merecen la misma confianza, y quien va a ir necesita saberlo.
          field('Cómo se ubicó', LOCATION_TYPE[ticket.locationType] ?? null),
          coords,
          field(
            'Precisión del GPS',
            ticket.gpsAccuracyMeters != null
              ? `± ${ticket.gpsAccuracyMeters} m`
              : null,
          ),
        ]),
        section('Atención', [
          field('Estado', status.label, NotificationFieldKind.BADGE),
          field('Responsable', this.assigneeLabel(ticket)),
          field(
            'Visita estimada',
            ticket.scheduledFor,
            NotificationFieldKind.DATE,
          ),
          field('Vence', ticket.slaDueAt, NotificationFieldKind.DATE),
          field(
            'Incumplido desde',
            ticket.slaBreachedAt,
            NotificationFieldKind.DATE,
          ),
          field('Reportó', ticket.reportedByName),
          field(
            'Unidad de quien reportó',
            ticket.reportedByUnit?.number
              ? unitLabel(ticket.reportedByUnit)
              : null,
          ),
          field(
            'Vecinos que confirman',
            ticket.endorsementCount ? `${ticket.endorsementCount + 1}` : null,
          ),
          field(
            'Plazo comprometido',
            ticket.slaHours ? `${ticket.slaHours} h` : null,
          ),
          field('Radicado', ticket.createdAt, NotificationFieldKind.DATE),
        ]),
        section('Cierre', [
          field(
            'Trabajo realizado',
            ticket.resolutionNotes,
            NotificationFieldKind.MULTILINE,
          ),
          field('Reparado', ticket.resolvedAt, NotificationFieldKind.DATE),
          field('Costo', ticket.actualCost, NotificationFieldKind.MONEY),
          field(
            'Calificación',
            ticket.rating != null ? `${ticket.rating}/5` : null,
          ),
          field(
            'Comentario',
            ticket.ratingComment,
            NotificationFieldKind.MULTILINE,
          ),
          field(
            'Motivo del rechazo',
            ticket.rejectionReason,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
      ],
      images: [...photos, ...closurePhotos],
      files: [file(ticket.videoUrl, 'Video del reporte')],
      actions: this.ticketActions(ticket, currentUser),
      source: NotificationSnapshotSource.LIVE,
    });
  }

  async execute({
    notification,
    currentUser,
    actionCode,
    values,
  }: NotificationActionContext): Promise<void> {
    const entityId = notification.entityId;
    if (!entityId) return;

    // El código llega como texto desde el aviso: se estrecha al enum propio
    // para que el switch compare peras con peras.
    switch (actionCode as MaintenanceActionCode) {
      case MaintenanceActionCode.TICKET_TRIAGE:
        await this.ticketsService.triage(
          {
            ticketId: entityId,
            priority: this.priority(values.priority),
            notes: this.text(values.notes) ?? undefined,
          },
          currentUser,
        );
        return;

      case MaintenanceActionCode.TICKET_REJECT:
        await this.ticketsService.reject(
          entityId,
          this.required(values.reason, 'el motivo'),
          currentUser,
        );
        return;

      case MaintenanceActionCode.TICKET_CLOSE:
        await this.ticketsService.close(entityId, currentUser);
        return;

      case MaintenanceActionCode.TICKET_REOPEN:
        await this.ticketsService.reopen(
          entityId,
          this.required(values.reason, 'lo que quedó mal'),
          currentUser,
        );
        return;

      case MaintenanceActionCode.TICKET_RATE:
        await this.ticketsService.rate(
          {
            ticketId: entityId,
            rating: Number(values.rating),
            comment: this.text(values.comment) ?? undefined,
          },
          currentUser,
        );
        return;

      default:
        return;
    }
  }

  // ================================================================
  // QUÉ SE PUEDE HACER
  // ================================================================

  /**
   * Las acciones se arman con el estado de HOY: si otro administrador ya asignó
   * el ticket mientras este tenía el aviso abierto, al recargar no quedan
   * botones que no llevan a ninguna parte.
   */
  private ticketActions(
    ticket: MaintenanceTicket,
    currentUser: NotificationSnapshotContext['currentUser'],
  ): NotificationSnapshotAction[] {
    const isManager = this.isManager(currentUser);
    const isReporter = ticket.reportedByUserId === currentUser.sub;

    if (isManager) {
      switch (ticket.status) {
        case MaintenanceTicketStatus.NEW:
          return [
            action({
              code: MaintenanceActionCode.TICKET_TRIAGE,
              label: 'Dar curso al reporte',
              description: 'Fija la urgencia y arranca el plazo de atención',
              tone: NotificationActionTone.PRIMARY,
              fields: [
                actionField({
                  name: 'priority',
                  label: 'Urgencia',
                  kind: NotificationActionFieldKind.SELECT,
                  options: Object.entries(PRIORITY).map(([value, label]) => ({
                    value,
                    label,
                  })),
                  defaultValue: ticket.priority,
                }),
                actionField({
                  name: 'notes',
                  label: 'Notas internas',
                  kind: NotificationActionFieldKind.TEXTAREA,
                  placeholder: 'Opcional. No lo ve el residente',
                }),
              ],
            }),
            action({
              code: MaintenanceActionCode.TICKET_REJECT,
              label: 'No procede',
              tone: NotificationActionTone.DANGER,
              fields: [
                actionField({
                  name: 'reason',
                  label: 'Motivo',
                  kind: NotificationActionFieldKind.TEXTAREA,
                  required: true,
                  minLength: MIN_REASON,
                  helpText:
                    'El residente lo recibe tal cual en la notificación',
                }),
              ],
            }),
          ];

        case MaintenanceTicketStatus.RESOLVED:
          return [
            action({
              code: MaintenanceActionCode.TICKET_CLOSE,
              label: 'Cerrar el ticket',
              tone: NotificationActionTone.PRIMARY,
              confirmText: `¿Cerrar ${ticket.code} sin esperar la confirmación del residente?`,
            }),
            action({
              code: MaintenanceActionCode.TICKET_REOPEN,
              label: 'Reabrir',
              description: 'El arreglo no sirvió',
              tone: NotificationActionTone.DANGER,
              fields: [
                actionField({
                  name: 'reason',
                  label: 'Qué quedó mal',
                  kind: NotificationActionFieldKind.TEXTAREA,
                  required: true,
                  minLength: MIN_REASON,
                }),
              ],
            }),
          ];

        default:
          return [];
      }
    }

    // Quien reportó califica o reabre desde el mismo aviso: si tiene que
    // buscar el ticket en la app, no lo hace.
    if (isReporter && ticket.status === MaintenanceTicketStatus.RESOLVED) {
      return [
        action({
          code: MaintenanceActionCode.TICKET_RATE,
          label: 'Quedó bien',
          description: 'Confirma el trabajo y califica la atención',
          tone: NotificationActionTone.PRIMARY,
          fields: [
            actionField({
              name: 'rating',
              label: 'Calificación',
              kind: NotificationActionFieldKind.SELECT,
              required: true,
              options: [5, 4, 3, 2, 1].map((value) => ({
                value: String(value),
                label: `${value} / 5`,
              })),
              defaultValue: '5',
            }),
            actionField({
              name: 'comment',
              label: 'Comentario',
              kind: NotificationActionFieldKind.TEXTAREA,
            }),
          ],
        }),
        action({
          code: MaintenanceActionCode.TICKET_REOPEN,
          label: 'Sigue dañado',
          tone: NotificationActionTone.DANGER,
          fields: [
            actionField({
              name: 'reason',
              label: 'Qué quedó mal',
              kind: NotificationActionFieldKind.TEXTAREA,
              required: true,
              minLength: MIN_REASON,
            }),
          ],
        }),
      ];
    }

    return [];
  }

  // ================================================================
  // HELPERS
  // ================================================================

  private isManager(user: NotificationSnapshotContext['currentUser']): boolean {
    const managers = [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ];
    return user.roles?.some((role) => managers.includes(role)) ?? false;
  }

  /** Los sótanos se guardan negativos; "-1" no se lee, "Sótano 1" sí. */
  private floorLabel(floor?: number | null): string | null {
    if (floor == null) return null;
    return floor < 0 ? `Sótano ${Math.abs(floor)}` : `Piso ${floor}`;
  }

  private locationLabel(ticket: MaintenanceTicket): string | null {
    return (
      ticket.locationTag?.name ??
      ticket.amenity?.name ??
      ticket.locationText ??
      ticket.building?.name ??
      null
    );
  }

  private assigneeLabel(ticket: MaintenanceTicket): string | null {
    if (ticket.vendor?.name) return `${ticket.vendor.name} (proveedor)`;
    if (ticket.assignedUser) {
      const name =
        `${ticket.assignedUser.name ?? ''} ${ticket.assignedUser.lastName ?? ''}`.trim();
      return name || ticket.assignedUser.email;
    }
    return null;
  }

  private text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private required(value: unknown, what: string): string {
    const text = this.text(value);

    if (!text) {
      throw new CustomError({
        message: `Debes indicar ${what}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    return text;
  }

  private priority(value: unknown): MaintenancePriority | undefined {
    if (typeof value !== 'string') return undefined;
    return Object.values(MaintenancePriority).includes(
      value as MaintenancePriority,
    )
      ? (value as MaintenancePriority)
      : undefined;
  }
}
