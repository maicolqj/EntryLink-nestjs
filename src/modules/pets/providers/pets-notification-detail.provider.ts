import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';

import { PetsService } from '../services/pets.service';
import { PetIncidentsService } from '../services/pet-incidents.service';
import { Pet } from '../entities/pet.entity';
import { PetIncident } from '../entities/pet-incident.entity';
import { PetStatus } from '../enums/pet-status.enum';
import { PetIncidentStatus } from '../enums/pet-incident-status.enum';

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
  NotificationActionOption,
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
import { PetIncidentSeverity } from '../enums/pet-incident-severity.enum';
import { PetSanction } from '../enums/pet-sanction.enum';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Qué se ve cuando se abre un aviso de mascotas.
 *
 * "Se registró KODA (raza de manejo especial) y está pendiente de validación"
 * no alcanza para aprobar ni rechazar nada: quien valida necesita la foto, la
 * raza, la unidad y —si es de manejo especial— la póliza. Eso es exactamente lo
 * que arma este proveedor.
 *
 * Las dos consultas pasan por el servicio del módulo y no por el repositorio:
 * así el expediente hereda los mismos permisos que la pantalla —el residente
 * solo ve lo de su unidad— y, en los reportes, el mismo enmascaramiento de
 * quien reportó. Un expediente que se salte eso expone al vecino que denunció.
 */

const SPECIES: Record<string, string> = {
  DOG: 'Perro',
  CAT: 'Gato',
  BIRD: 'Ave',
  RODENT: 'Roedor',
  REPTILE: 'Reptil',
  FISH: 'Pez',
  OTHER: 'Otra',
};

const SEX: Record<string, string> = { MALE: 'Macho', FEMALE: 'Hembra' };

const SIZE: Record<string, string> = {
  SMALL: 'Pequeño',
  MEDIUM: 'Mediano',
  LARGE: 'Grande',
  GIANT: 'Gigante',
};

const PET_STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [PetStatus.PENDING_APPROVAL]: {
    label: 'Pendiente de validación',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PetStatus.ACTIVE]: {
    label: 'Censada y autorizada',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [PetStatus.REJECTED]: {
    label: 'Ficha rechazada',
    tone: NotificationSnapshotTone.DANGER,
  },
  [PetStatus.SUSPENDED]: {
    label: 'Autorización suspendida',
    tone: NotificationSnapshotTone.DANGER,
  },
  [PetStatus.REMOVED]: {
    label: 'Retirada del censo',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [PetStatus.DECEASED]: {
    label: 'Fallecida',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
};

const INCIDENT_TYPE: Record<string, string> = {
  WASTE_NOT_PICKED_UP: 'No recogió las deposiciones',
  OFF_LEASH: 'Circulaba sin traílla o sin bozal',
  NOISE: 'Ruido (ladridos)',
  AGGRESSION: 'Agresión o intento de agresión',
  RESTRICTED_AREA: 'En zona no permitida',
  UNREGISTERED_PET: 'Mascota sin registrar',
  ABANDONMENT: 'Posible abandono o maltrato',
  OTHER: 'Otro',
};

const SEVERITY: Record<string, string> = {
  LOW: 'Leve',
  MEDIUM: 'Media',
  HIGH: 'Grave',
};

const INCIDENT_STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [PetIncidentStatus.REPORTED]: {
    label: 'Pendiente de revisión',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PetIncidentStatus.UNDER_DEFENSE]: {
    label: 'En plazo de descargos',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PetIncidentStatus.DISMISSED]: {
    label: 'Desestimado',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [PetIncidentStatus.WARNED]: {
    label: 'Llamado de atención',
    tone: NotificationSnapshotTone.WARNING,
  },
  [PetIncidentStatus.FINED]: {
    label: 'Multa cargada',
    tone: NotificationSnapshotTone.DANGER,
  },
};

/**
 * Quién puede tramitar. Se repite aquí a propósito y en negativo: esto solo
 * decide qué botones se PINTAN. Quien decide si la acción se ejecuta es el
 * servicio (`assertManager`), que es el único sitio donde puede estar la regla.
 */
const MANAGER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
];

/** Códigos de las acciones. Viajan a la web y vuelven tal cual: son contrato. */
export const PetActionCode = {
  INCIDENT_VALIDATE: 'PET_INCIDENT_VALIDATE',
  INCIDENT_DISMISS: 'PET_INCIDENT_DISMISS',
  INCIDENT_WARN: 'PET_INCIDENT_WARN',
  INCIDENT_FINE: 'PET_INCIDENT_FINE',
  INCIDENT_STATEMENT: 'PET_INCIDENT_STATEMENT',
  PET_APPROVE: 'PET_APPROVE',
  PET_REJECT: 'PET_REJECT',
  PET_SUSPEND: 'PET_SUSPEND',
  PET_REACTIVATE: 'PET_REACTIVATE',
} as const;

/** Motivación mínima de una decisión sancionatoria (lo exigen los inputs). */
const MIN_REASON = 10;

@Injectable()
export class PetsNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  // `petIncident` es el valor que quedó guardado en los avisos emitidos antes
  // de unificar el nombre: sin el alias, esos avisos siguen cayendo al
  // fallback de `metadata` —sin fotos y sin el relato— para siempre.
  readonly entityTypes = ['pet', 'pet_incident', 'petIncident'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly petsService: PetsService,
    private readonly incidentsService: PetIncidentsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    return notification.entityType?.toLowerCase() === 'pet'
      ? this.buildPet(notification.entityId, currentUser)
      : this.buildIncident(notification.entityId, currentUser);
  }

  // ================================================================
  // FICHA DE LA MASCOTA
  // ================================================================

  private async buildPet(
    petId: string,
    currentUser: NotificationSnapshotContext['currentUser'],
  ): Promise<NotificationEntitySnapshot> {
    const pet: Pet = await this.petsService.findById(petId, currentUser);
    const status = PET_STATUS[pet.status] ?? {
      label: String(pet.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    // La póliza vencida importa tanto como la que falta: aprobar con una
    // vencida deja a la copropiedad respondiendo igual que sin ninguna.
    const policyExpired =
      !!pet.insuranceExpiresAt && new Date(pet.insuranceExpiresAt) < new Date();

    const residentName = pet.resident?.user
      ? `${pet.resident.user.name ?? ''} ${pet.resident.user.lastName ?? ''}`.trim()
      : null;

    return snapshot({
      entityType: 'pet',
      entityId: pet.id,
      statusCode: pet.status,
      headline: [pet.name, SPECIES[pet.species] ?? pet.species, pet.breed]
        .filter(Boolean)
        .join(' · '),
      statusLabel: status.label,
      statusTone: status.tone,
      sections: [
        section('Quién es', [
          field('Nombre', pet.name),
          field('Especie', SPECIES[pet.species] ?? pet.species),
          field('Raza', pet.breed),
          field('Color', pet.color),
          field('Sexo', pet.sex ? SEX[pet.sex] : null),
          field('Porte', pet.size ? SIZE[pet.size] : null),
          // Se muestra SIEMPRE, también cuando es "No": es el dato que decide
          // si la ficha exige póliza para aprobarse, y quien valida tiene que
          // ver que se respondió, no deducirlo de que falte el renglón.
          field(
            'Raza de manejo especial',
            pet.isSpecialBreed ? 'Sí' : 'No',
            NotificationFieldKind.BADGE,
          ),
          field('Nacimiento', pet.birthDate, NotificationFieldKind.DATE),
          field(
            'Señas particulares',
            pet.distinguishingMarks,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
        section('Dónde vive', [
          field('Unidad', unitLabel(pet.unit)),
          field('Residente', residentName),
        ]),
        section('Identificación y salud', [
          field(
            'Microchip',
            pet.hasMicrochip ? (pet.microchipCode ?? 'Sí') : 'No',
          ),
          field('Esterilizada', pet.sterilized),
          field(
            'Última vacuna antirrábica',
            pet.rabiesVaccineAt,
            NotificationFieldKind.DATE,
          ),
        ]),
        // Solo aparece cuando aplica: en una mascota común, un renglón que diga
        // "no requiere póliza" es ruido para quien valida.
        pet.isSpecialBreed
          ? section('Raza de manejo especial (Ley 2054 de 2020)', [
              field(
                'Póliza de responsabilidad civil',
                pet.insurancePolicyNumber ?? 'SIN REGISTRAR',
                NotificationFieldKind.BADGE,
              ),
              field('Aseguradora', pet.insuranceCompany),
              field(
                policyExpired ? 'Venció' : 'Vence',
                pet.insuranceExpiresAt,
                NotificationFieldKind.DATE,
              ),
            ])
          : null,
        section('Trámite', [
          field('Estado', status.label, NotificationFieldKind.BADGE),
          field('Registrada', pet.createdAt, NotificationFieldKind.DATE),
          field(
            'Motivo del rechazo',
            pet.status === PetStatus.REJECTED ? pet.rejectionReason : null,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
      ],
      images: [image(pet.photoUrl, pet.name)],
      files: [file(pet.vaccinationCardUrl, 'Carné de vacunación')],
      actions: this.petActions(pet, currentUser),
      source: NotificationSnapshotSource.LIVE,
    });
  }

  // ================================================================
  // REPORTE DE CONVIVENCIA
  // ================================================================

  private async buildIncident(
    incidentId: string,
    currentUser: NotificationSnapshotContext['currentUser'],
  ): Promise<NotificationEntitySnapshot> {
    const incident: PetIncident = await this.incidentsService.findById(
      incidentId,
      currentUser,
    );
    const status = INCIDENT_STATUS[incident.status] ?? {
      label: String(incident.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    const photos = (incident.photoUrls ?? []).map((url, index) =>
      image(
        url,
        `Evidencia ${index + 1}`,
        // El hash viaja con la foto: es lo que sostiene después que la imagen
        // del expediente es la que recibió el servidor ese día.
        incident.photoHashes?.[index] ?? null,
      ),
    );

    const coords =
      incident.lat != null && incident.lng != null
        ? field(
            'Ubicación',
            `${incident.lat}, ${incident.lng}`,
            NotificationFieldKind.LOCATION,
            `https://www.google.com/maps/search/?api=1&query=${incident.lat},${incident.lng}`,
          )
        : null;

    return snapshot({
      entityType: 'pet_incident',
      entityId: incident.id,
      statusCode: incident.status,
      headline: `${incident.code} · ${INCIDENT_TYPE[incident.type] ?? incident.type}`,
      statusLabel: status.label,
      statusTone: status.tone,
      sections: [
        section('Qué pasó', [
          field('Motivo', INCIDENT_TYPE[incident.type] ?? incident.type),
          field('Gravedad', SEVERITY[incident.severity] ?? incident.severity),
          field(
            'Relato',
            incident.description,
            NotificationFieldKind.MULTILINE,
          ),
          field('Ocurrió', incident.occurredAt, NotificationFieldKind.DATE),
          field('Lugar', incident.location),
          coords,
        ]),
        section('A quién se le atribuye', [
          field('Mascota', incident.pet?.name ?? 'Sin identificar'),
          field('Unidad', unitLabel(incident.unit) ?? 'Sin identificar'),
        ]),
        // `reportedByName` llega ya enmascarado por el servicio cuando quien
        // mira es la unidad señalada: si viene en blanco, no se muestra.
        section('Quién reportó', [
          field('Reportó', incident.reportedByName),
          field('Rol', incident.reportedByRole),
          field('Radicado', incident.createdAt, NotificationFieldKind.DATE),
        ]),
        section('Trámite', [
          field('Estado', status.label, NotificationFieldKind.BADGE),
          field(
            'Plazo de descargos',
            incident.statementDueAt,
            NotificationFieldKind.DATE,
          ),
          field(
            'Descargos presentados',
            incident.statements?.length
              ? `${incident.statements.length}`
              : null,
          ),
          field(
            'Decisión',
            incident.resolutionNotes,
            NotificationFieldKind.MULTILINE,
          ),
          field('Multa', incident.fineAmount, NotificationFieldKind.MONEY),
        ]),
      ],
      images: photos,
      actions: await this.incidentActions(incident, currentUser),
      source: NotificationSnapshotSource.LIVE,
    });
  }

  // ================================================================
  // QUÉ SE PUEDE HACER
  // ================================================================

  /**
   * El trámite de la ficha, desde el aviso.
   *
   * Las acciones se arman con el estado de HOY: si otro administrador ya aprobó
   * la mascota mientras este tenía el aviso abierto, al recargar no quedan
   * botones que no llevan a ninguna parte.
   */
  private petActions(
    pet: Pet,
    currentUser: NotificationSnapshotContext['currentUser'],
  ): NotificationSnapshotAction[] {
    if (!this.isManager(currentUser)) return [];

    const notes = actionField({
      name: 'notes',
      label: 'Notas internas',
      kind: NotificationActionFieldKind.TEXTAREA,
      placeholder: 'Opcional. No lo ve el residente',
    });

    const reason = (label: string) =>
      actionField({
        name: 'reason',
        label,
        kind: NotificationActionFieldKind.TEXTAREA,
        required: true,
        minLength: MIN_REASON,
        helpText: 'El residente lo recibe tal cual en la notificación',
      });

    switch (pet.status) {
      case PetStatus.PENDING_APPROVAL:
        return [
          action({
            code: PetActionCode.PET_APPROVE,
            label: 'Aprobar la ficha',
            description: 'Queda en el censo y la portería puede identificarla',
            tone: NotificationActionTone.PRIMARY,
            // La póliza vencida bloquea igual que la que falta: aprobar así
            // deja a la copropiedad respondiendo como si no hubiera ninguna.
            disabledReason: this.insuranceBlocker(pet),
            fields: [notes],
          }),
          action({
            code: PetActionCode.PET_REJECT,
            label: 'Rechazar',
            tone: NotificationActionTone.DANGER,
            fields: [reason('Motivo del rechazo')],
          }),
        ];

      case PetStatus.ACTIVE:
        return [
          action({
            code: PetActionCode.PET_SUSPEND,
            label: 'Suspender la autorización',
            description: 'Deja de estar autorizada hasta que se reactive',
            tone: NotificationActionTone.DANGER,
            confirmText: `¿Suspender la autorización de ${pet.name}?`,
            fields: [reason('Motivo de la suspensión')],
          }),
        ];

      case PetStatus.SUSPENDED:
        return [
          action({
            code: PetActionCode.PET_REACTIVATE,
            label: 'Reactivar',
            tone: NotificationActionTone.PRIMARY,
            disabledReason: this.insuranceBlocker(pet),
          }),
        ];

      default:
        return [];
    }
  }

  /** El trámite del reporte de convivencia, desde el aviso. */
  private async incidentActions(
    incident: PetIncident,
    currentUser: NotificationSnapshotContext['currentUser'],
  ): Promise<NotificationSnapshotAction[]> {
    if (!this.isManager(currentUser)) {
      return this.residentActions(incident, currentUser);
    }

    const resolutionNotes = actionField({
      name: 'resolutionNotes',
      label: 'Motivación de la decisión',
      kind: NotificationActionFieldKind.TEXTAREA,
      required: true,
      minLength: MIN_REASON,
      helpText:
        'Queda en el expediente y le llega a la unidad. Una sanción sin motivar no se sostiene si la discuten',
    });

    const dismiss = action({
      code: PetActionCode.INCIDENT_DISMISS,
      label: 'Desestimar',
      description: 'Cierra el caso sin sanción',
      tone: NotificationActionTone.NEUTRAL,
      fields: [
        actionField({
          name: 'reason',
          label: 'Motivo',
          kind: NotificationActionFieldKind.TEXTAREA,
          required: true,
          minLength: MIN_REASON,
        }),
      ],
    });

    if (incident.status === PetIncidentStatus.REPORTED) {
      return [
        action({
          code: PetActionCode.INCIDENT_VALIDATE,
          label: 'Dar curso y notificar a la unidad',
          description:
            'Atribuye el hecho, avisa a la unidad y arranca el plazo de descargos',
          tone: NotificationActionTone.PRIMARY,
          fields: [
            actionField({
              name: 'petId',
              label: 'Mascota señalada',
              kind: NotificationActionFieldKind.SELECT,
              defaultValue: incident.petId,
              options: await this.petOptions(incident.complexId, currentUser),
              helpText:
                'Quien reporta se equivoca de perro con facilidad, y de esto depende a quién se le cobra',
            }),
            actionField({
              name: 'unitId',
              label: 'Unidad responsable',
              kind: NotificationActionFieldKind.UNIT,
              defaultValue: incident.unitId,
              defaultLabel: unitLabel(incident.unit),
              helpText:
                'Si la mascota no está en el censo, identifica al menos la unidad',
            }),
            actionField({
              name: 'severity',
              label: 'Gravedad',
              kind: NotificationActionFieldKind.SELECT,
              defaultValue: incident.severity,
              options: Object.entries(SEVERITY).map(([value, label]) => ({
                value,
                label,
                hint: null,
              })),
            }),
            actionField({
              name: 'notes',
              label: 'Notas internas',
              kind: NotificationActionFieldKind.TEXTAREA,
            }),
          ],
        }),
        dismiss,
      ];
    }

    if (incident.status === PetIncidentStatus.UNDER_DEFENSE) {
      const defenseBlocker = this.defenseBlocker(incident);

      return [
        action({
          code: PetActionCode.INCIDENT_WARN,
          label: 'Llamado de atención',
          description: 'Cierra el caso sin cobro',
          tone: NotificationActionTone.WARNING,
          disabledReason: defenseBlocker,
          fields: [resolutionNotes],
        }),
        action({
          code: PetActionCode.INCIDENT_FINE,
          label: 'Multar',
          description: 'Carga la multa al estado de cuenta de la unidad',
          tone: NotificationActionTone.DANGER,
          disabledReason: defenseBlocker,
          confirmText:
            'La multa entra al estado de cuenta de la unidad y queda en los libros. ¿Confirmas?',
          fields: [
            actionField({
              name: 'fineAmount',
              label: 'Valor de la multa',
              kind: NotificationActionFieldKind.MONEY,
              required: true,
              min: 1,
            }),
            resolutionNotes,
          ],
        }),
        dismiss,
      ];
    }

    // DISMISSED, WARNED, FINED: el caso ya se cerró y no se reabre desde aquí.
    return [];
  }

  /**
   * Lo único que puede hacer un residente sobre un reporte: responderlo.
   *
   * Y solo la unidad señalada. A quien reportó no se le ofrece —no tiene nada
   * que contestar— y distinguirlos es directo: el servicio ya le borró la
   * identidad de quien reportó a todo el que no sea staff ni el reportante, así
   * que un `reportedByUserId` en blanco es exactamente "soy la unidad acusada".
   */
  private residentActions(
    incident: PetIncident,
    currentUser: NotificationSnapshotContext['currentUser'],
  ): NotificationSnapshotAction[] {
    const isReporter = incident.reportedByUserId === currentUser.sub;
    if (isReporter) return [];
    if (incident.status !== PetIncidentStatus.UNDER_DEFENSE) return [];

    const expired =
      !!incident.statementDueAt &&
      new Date() > new Date(incident.statementDueAt);

    return [
      action({
        code: PetActionCode.INCIDENT_STATEMENT,
        label: 'Presentar descargos',
        description: 'Tu versión queda en el expediente antes de que se decida',
        tone: NotificationActionTone.PRIMARY,
        disabledReason: expired
          ? `El plazo para responder venció el ${this.formatDate(incident.statementDueAt)}`
          : null,
        fields: [
          actionField({
            name: 'text',
            label: 'Tu respuesta',
            kind: NotificationActionFieldKind.TEXTAREA,
            required: true,
            minLength: MIN_REASON,
            placeholder: 'Cuenta qué pasó desde tu lado',
          }),
        ],
      }),
    ];
  }

  // ================================================================
  // EJECUCIÓN
  // ================================================================

  /**
   * Todo pasa por el servicio del módulo: ahí están los permisos, el debido
   * proceso y los avisos que salen después. Lo que llega de la web son valores,
   * nunca una decisión ya tomada.
   */
  async execute({
    notification,
    currentUser,
    actionCode,
    values,
  }: NotificationActionContext): Promise<void> {
    const entityId = notification.entityId;
    if (!entityId) return;

    switch (actionCode) {
      case PetActionCode.INCIDENT_VALIDATE:
        await this.incidentsService.validate(
          {
            incidentId: entityId,
            petId: this.text(values.petId) ?? undefined,
            unitId: this.text(values.unitId) ?? undefined,
            severity: this.severity(values.severity),
            notes: this.text(values.notes) ?? undefined,
          },
          currentUser,
        );
        return;

      case PetActionCode.INCIDENT_DISMISS:
        await this.incidentsService.dismiss(
          entityId,
          this.required(values.reason, 'el motivo'),
          currentUser,
        );
        return;

      case PetActionCode.INCIDENT_WARN:
        await this.incidentsService.sanction(
          {
            incidentId: entityId,
            sanction: PetSanction.WARNING,
            resolutionNotes: this.required(
              values.resolutionNotes,
              'la motivación',
            ),
          },
          currentUser,
        );
        return;

      case PetActionCode.INCIDENT_FINE:
        await this.incidentsService.sanction(
          {
            incidentId: entityId,
            sanction: PetSanction.FINE,
            fineAmount: this.amount(values.fineAmount),
            resolutionNotes: this.required(
              values.resolutionNotes,
              'la motivación',
            ),
          },
          currentUser,
        );
        return;

      case PetActionCode.INCIDENT_STATEMENT:
        await this.incidentsService.addStatement(
          {
            incidentId: entityId,
            text: this.required(values.text, 'tu respuesta'),
          },
          currentUser,
        );
        return;

      case PetActionCode.PET_APPROVE:
        await this.petsService.approve(
          { petId: entityId, notes: this.text(values.notes) ?? undefined },
          currentUser,
        );
        return;

      case PetActionCode.PET_REJECT:
        await this.petsService.reject(
          entityId,
          this.required(values.reason, 'el motivo del rechazo'),
          currentUser,
        );
        return;

      case PetActionCode.PET_SUSPEND:
        await this.petsService.suspend(
          entityId,
          this.required(values.reason, 'el motivo de la suspensión'),
          currentUser,
        );
        return;

      case PetActionCode.PET_REACTIVATE:
        await this.petsService.reactivate(entityId, currentUser);
        return;

      default:
        throw new CustomError({
          message: `Acción no reconocida: ${actionCode}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
    }
  }

  // ================================================================
  // APOYO
  // ================================================================

  private isManager(
    currentUser: NotificationSnapshotContext['currentUser'],
  ): boolean {
    return (
      currentUser.roles?.some((role) => MANAGER_ROLES.includes(role)) ?? false
    );
  }

  /** Por qué NO se puede aprobar todavía, o `null` si se puede. */
  private insuranceBlocker(pet: Pet): string | null {
    if (!pet.isSpecialBreed) return null;

    if (!pet.insurancePolicyNumber || !pet.insuranceExpiresAt) {
      return 'Falta la póliza de responsabilidad civil, obligatoria para razas de manejo especial (Ley 2054 de 2020)';
    }

    if (new Date(pet.insuranceExpiresAt) < new Date()) {
      return `La póliza de responsabilidad civil venció el ${this.formatDate(pet.insuranceExpiresAt)}`;
    }

    return null;
  }

  /**
   * Por qué no se puede sancionar todavía. Es el mismo freno del servicio
   * (Ley 675, art. 59) dicho antes de pulsar: el administrador ve el botón en
   * gris con la fecha en vez de escribir la motivación y perderla contra un
   * error.
   */
  private defenseBlocker(incident: PetIncident): string | null {
    const answered = incident.statements?.length ?? 0;
    if (answered > 0) return null;

    if (
      incident.statementDueAt &&
      new Date() < new Date(incident.statementDueAt)
    ) {
      return `La unidad tiene plazo para presentar descargos hasta el ${this.formatDate(incident.statementDueAt)}`;
    }

    return null;
  }

  /** El censo, para atribuirle el hecho a una mascota concreta. */
  private async petOptions(
    complexId: string,
    currentUser: NotificationSnapshotContext['currentUser'],
  ): Promise<NotificationActionOption[]> {
    const { items } = await this.petsService.findByComplex(
      complexId,
      { page: 1, limit: 200 },
      {},
      currentUser,
    );

    return items.map((pet) => ({
      value: pet.id,
      label: [pet.name, pet.breed].filter(Boolean).join(' · '),
      // La torre importa tanto como el número: en un conjunto con seis
      // edificios, un "101" no identifica a nadie.
      hint: unitLabel(pet.unit),
    }));
  }

  private text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  private required(value: unknown, what: string): string {
    const text = this.text(value);
    if (!text) {
      throw new CustomError({
        message: `Falta ${what}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }
    return text;
  }

  private amount(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new CustomError({
        message: 'El valor de la multa no es válido',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }
    return parsed;
  }

  private severity(value: unknown): PetIncidentSeverity | undefined {
    const text = this.text(value);
    if (!text) return undefined;
    return Object.values(PetIncidentSeverity).includes(
      text as PetIncidentSeverity,
    )
      ? (text as PetIncidentSeverity)
      : undefined;
  }

  private formatDate(value?: Date | string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Bogota',
    });
  }
}
