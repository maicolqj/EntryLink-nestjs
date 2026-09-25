import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { PetIncident } from '../entities/pet-incident.entity';
import { PetIncidentStatement } from '../entities/pet-incident-statement.entity';
import { Pet } from '../entities/pet.entity';
import { PetIncidentStatus } from '../enums/pet-incident-status.enum';
import { PetIncidentSeverity } from '../enums/pet-incident-severity.enum';
import { PetSanction } from '../enums/pet-sanction.enum';
import { ReportPetIncidentDto } from '../dto/inputs/report-pet-incident.input';
import { FilterPetIncidentsInput } from '../dto/inputs/filter-pet-incidents.input';
import { ValidatePetIncidentInput } from '../dto/inputs/validate-pet-incident.input';
import { SanctionPetIncidentInput } from '../dto/inputs/sanction-pet-incident.input';
import { CreatePetIncidentStatementInput } from '../dto/inputs/create-pet-incident-statement.input';
import { PaginatedPetIncidentsResponse } from '../dto/responses/paginated-pet-incidents.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  PetErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { AccountingService } from '../../finance/services/accounting.service';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { isPetsModuleEnabled } from '../utils/pets-module.util';

/** Datos de radicación: el DTO del REST más la evidencia ya subida a R2. */
export type ReportIncidentData = ReportPetIncidentDto & {
  photoUrls: string[];
  photoHashes: string[];
};

/** Quien gestiona el trámite: valida, desestima y sanciona. */
const MANAGER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
];

/** Quien además puede leer todos los reportes (la portería reporta y consulta). */
const STAFF_ROLES = [...MANAGER_ROLES, ValidRoles.SECURITY_ROL];

/** Estados en los que el caso ya terminó con una sanción sobre la unidad. */
const SANCTIONED_STATES = [PetIncidentStatus.WARNED, PetIncidentStatus.FINED];

@Injectable()
export class PetIncidentsService {
  private readonly logger = new Logger(PetIncidentsService.name);

  constructor(
    @InjectRepository(PetIncident)
    private readonly incidentRepo: Repository<PetIncident>,
    @InjectRepository(PetIncidentStatement)
    private readonly statementRepo: Repository<PetIncidentStatement>,
    @InjectRepository(Pet)
    private readonly petRepo: Repository<Pet>,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly accountingService: AccountingService,
    private readonly auditService: AuditService,
    private readonly socketService: SocketService,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // RADICAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Radica el reporte. La unidad señalada NO se entera todavía: mientras nadie
   * lo revise es la palabra de un vecino contra otro, y avisar en ese momento
   * convierte el módulo en un ring entre apartamentos.
   *
   * El consecutivo se calcula dentro de la transacción y con bloqueo del
   * complejo: dos vecinos reportando en el mismo segundo no pueden llevarse el
   * mismo número de expediente, que es el que después se cita en la multa.
   */
  async report(
    data: ReportIncidentData,
    currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    const complex = await this.complexService.findById(
      data.complexId,
      currentUser,
    );
    const isStaff = this.isStaff(currentUser);

    if (!isStaff) {
      if (!isPetsModuleEnabled(complex)) {
        throw new CustomError({
          message: 'El módulo de mascotas no está habilitado en este complejo',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: PetErrorCode.PETS_MODULE_DISABLED,
        });
      }
      if (!complex.petsResidentReportingEnabled) {
        throw new CustomError({
          message:
            'En este complejo los reportes los radica la administración o la portería',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: PetErrorCode.PET_INCIDENT_REPORTING_DISABLED,
        });
      }
    }

    // Sin evidencia no hay expediente: una foto con hora de servidor es lo que
    // convierte una queja en algo con lo que se puede sancionar.
    if (!data.photoUrls?.length) {
      throw new CustomError({
        message: 'Debes adjuntar al menos una foto como evidencia',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INCIDENT_EVIDENCE_REQUIRED,
      });
    }

    const now = new Date();
    const occurredAt = data.occurredAt ? new Date(data.occurredAt) : now;

    // Un minuto de tolerancia por el desfase del reloj del celular.
    if (occurredAt.getTime() > now.getTime() + 60_000) {
      throw new CustomError({
        message: 'La fecha del hecho no puede estar en el futuro',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INCIDENT_OCCURRED_IN_FUTURE,
      });
    }

    const { petId, unitId } = await this.resolveTarget(
      data.complexId,
      data.petId,
      data.unitId,
      currentUser,
    );

    const reporter =
      await this.residentsService.findActiveResidentByUserIdInternal(
        currentUser.sub,
        data.complexId,
      );
    const reporterName = reporter?.user
      ? `${reporter.user.name ?? ''} ${reporter.user.lastName ?? ''}`.trim()
      : null;

    const saved = await this.dataSource.transaction(async (manager) => {
      // El bloqueo serializa solo a quienes radican en ESTE complejo y se
      // libera al terminar la transacción.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `pet-incident:${data.complexId}`,
      ]);

      const last = await manager
        .createQueryBuilder(PetIncident, 'i')
        .select('MAX(i.consecutive)', 'max')
        .where('i.complexId = :complexId', { complexId: data.complexId })
        .getRawOne<{ max: number | null }>();

      const consecutive = (last?.max ?? 0) + 1;

      return manager.save(
        manager.create(PetIncident, {
          complexId: data.complexId,
          consecutive,
          code: `MAS-${String(consecutive).padStart(6, '0')}`,
          type: data.type,
          severity: data.severity ?? PetIncidentSeverity.MEDIUM,
          description: data.description.trim(),
          photoUrls: data.photoUrls,
          photoHashes: data.photoHashes ?? [],
          occurredAt,
          location: data.location?.trim(),
          lat: data.lat,
          lng: data.lng,
          petId: petId ?? null,
          unitId: unitId ?? null,
          status: PetIncidentStatus.REPORTED,
          reportedByUserId:
            currentUser.entityType === 'user' ? currentUser.sub : null,
          reportedByRole: currentUser.roles?.[0] ?? null,
          reportedByName: reporterName || currentUser.email || null,
          reportedByUnitId: reporter?.unitId ?? null,
        }),
      );
    });

    this.logger.log(
      `Reporte de convivencia radicado: ${saved.code} — complejo ${data.complexId}`,
    );

    this.notifyManagers(
      saved,
      NotificationType.PET_INCIDENT_REPORTED,
      NotificationPriority.NORMAL,
      `Nuevo reporte de convivencia ${saved.code}`,
      `${this.describeType(saved)} — requiere revisión antes de notificar a la unidad.`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar el reporte ${saved.code}: ${err?.message}`,
      ),
    );

    this.socketService.emitToComplex(
      saved.complexId,
      SocketEvent.PET_INCIDENT_UPDATED,
      { incidentId: saved.id, status: saved.status },
    );

    void this.auditService.log({
      entityType: AuditEntityType.PetIncident,
      entityId: saved.id,
      action: AuditAction.CREATE,
      newValue: {
        code: saved.code,
        type: saved.type,
        severity: saved.severity,
        petId: saved.petId,
        unitId: saved.unitId,
        evidence: saved.photoUrls.length,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Reporte de convivencia radicado ${saved.code}`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDAR — abre el plazo de descargos
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * La administración le da curso al reporte: lo atribuye, notifica a la unidad
   * y arranca el plazo de descargos. El plazo se congela con la configuración
   * vigente hoy — cambiarla mañana no puede acortarle el término a un caso que
   * ya está en curso.
   */
  async validate(
    input: ValidatePetIncidentInput,
    currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    const incident = await this.findByIdOrFail(input.incidentId);
    const complex = await this.complexService.findById(
      incident.complexId,
      currentUser,
    );
    this.assertManager(currentUser);

    if (incident.status !== PetIncidentStatus.REPORTED) {
      throw new CustomError({
        message: `El reporte ya fue revisado. Estado actual: ${incident.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_INCIDENT_INVALID_STATUS,
      });
    }

    const { petId, unitId } = await this.resolveTarget(
      incident.complexId,
      input.petId ?? incident.petId ?? undefined,
      input.unitId ?? incident.unitId ?? undefined,
      currentUser,
    );

    // Sin unidad no hay a quién notificarle ni a quién sancionar: un caso que
    // avanza sin destinatario solo sirve para inflar estadísticas.
    if (!unitId) {
      throw new CustomError({
        message:
          'Debes identificar la mascota o al menos la unidad responsable antes de dar curso al reporte',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INCIDENT_TARGET_REQUIRED,
      });
    }

    const now = new Date();
    const statementDueAt = new Date(now);
    statementDueAt.setDate(
      statementDueAt.getDate() + (complex.petsStatementDays ?? 5),
    );

    incident.petId = petId ?? null;
    incident.unitId = unitId;
    incident.severity = input.severity ?? incident.severity;
    incident.status = PetIncidentStatus.UNDER_DEFENSE;
    incident.reviewedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;
    incident.reviewedAt = now;
    incident.statementDueAt = statementDueAt;

    const saved = await this.incidentRepo.save(incident);

    // La observación de quien revisa entra al expediente como una intervención
    // más, no pisando la decisión final: el hilo tiene que poder leerse en orden.
    if (input.notes?.trim()) {
      await this.statementRepo.save(
        this.statementRepo.create({
          incidentId: saved.id,
          complexId: saved.complexId,
          text: input.notes.trim(),
          // Observación de quien revisa, no descargo: no cierra el plazo.
          isDefense: false,
          authorUserId:
            currentUser.entityType === 'user' ? currentUser.sub : null,
          authorRole: currentUser.roles?.[0] ?? null,
          authorName: currentUser.email ?? null,
        }),
      );
    }

    this.notifyUnit(
      saved,
      NotificationType.PET_INCIDENT_VALIDATED,
      NotificationPriority.HIGH,
      `Reporte de convivencia ${saved.code}`,
      `Se recibió un reporte relacionado con una mascota de tu unidad. Tienes hasta el ${this.formatDate(statementDueAt)} para presentar tus descargos.`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar la validación de ${saved.code}: ${err?.message}`,
      ),
    );

    this.emitUpdate(saved);

    void this.auditService.log({
      entityType: AuditEntityType.PetIncident,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: { status: PetIncidentStatus.REPORTED },
      newValue: {
        status: saved.status,
        petId: saved.petId,
        unitId: saved.unitId,
        statementDueAt: saved.statementDueAt,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Reporte ${saved.code} validado y notificado a la unidad`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DESESTIMAR
  // ═══════════════════════════════════════════════════════════════════════════

  async dismiss(
    incidentId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    const incident = await this.findByIdOrFail(incidentId);
    await this.complexService.findById(incident.complexId, currentUser);
    this.assertManager(currentUser);

    if (
      incident.status !== PetIncidentStatus.REPORTED &&
      incident.status !== PetIncidentStatus.UNDER_DEFENSE
    ) {
      throw new CustomError({
        message: `El reporte ya está cerrado. Estado actual: ${incident.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_INCIDENT_INVALID_STATUS,
      });
    }

    // Si la unidad nunca supo del reporte, desestimarlo no le llega: enterarla
    // de una acusación justo cuando se descarta solo genera ruido.
    const unitWasNotified = incident.status === PetIncidentStatus.UNDER_DEFENSE;

    incident.status = PetIncidentStatus.DISMISSED;
    incident.resolutionNotes = reason.trim();
    incident.resolvedAt = new Date();
    incident.reviewedByUserId =
      incident.reviewedByUserId ??
      (currentUser.entityType === 'user' ? currentUser.sub : null);

    const saved = await this.incidentRepo.save(incident);

    if (unitWasNotified) {
      this.notifyUnit(
        saved,
        NotificationType.PET_INCIDENT_DISMISSED,
        NotificationPriority.NORMAL,
        `Reporte ${saved.code} desestimado`,
        `El reporte que se había abierto con tu unidad fue desestimado: ${saved.resolutionNotes}`,
      ).catch((err: Error) =>
        this.logger.warn(
          `Error al notificar el cierre de ${saved.code}: ${err?.message}`,
        ),
      );
    }

    this.emitUpdate(saved);

    void this.auditService.log({
      entityType: AuditEntityType.PetIncident,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      newValue: { status: saved.status, reason: saved.resolutionNotes },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Reporte ${saved.code} desestimado`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SANCIONAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cierra el caso con llamado de atención o con multa.
   *
   * No se puede sancionar mientras el plazo de descargos siga corriendo y la
   * unidad no haya respondido: es el requisito de la Ley 675 (art. 59) de oír
   * al implicado antes de sancionarlo. Saltárselo hace la multa anulable, así
   * que el freno vive en el servidor y no en la pantalla del administrador.
   */
  async sanction(
    input: SanctionPetIncidentInput,
    currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    const incident = await this.findByIdOrFail(input.incidentId);
    const complex = await this.complexService.findById(
      incident.complexId,
      currentUser,
    );
    this.assertManager(currentUser);

    if (incident.status !== PetIncidentStatus.UNDER_DEFENSE) {
      throw new CustomError({
        message: `Solo se puede sancionar un reporte validado y notificado. Estado actual: ${incident.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_INCIDENT_INVALID_STATUS,
      });
    }

    if (!incident.unitId) {
      throw new CustomError({
        message: 'El reporte no tiene unidad responsable identificada',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INCIDENT_TARGET_REQUIRED,
      });
    }

    await this.assertDefenseWindowClosed(incident);

    const now = new Date();
    const notes = input.resolutionNotes.trim();

    if (input.sanction === PetSanction.FINE) {
      if (!input.fineAmount || input.fineAmount <= 0) {
        throw new CustomError({
          message: 'Debes indicar el valor de la multa',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: PetErrorCode.PET_INCIDENT_FINE_AMOUNT_REQUIRED,
        });
      }

      const actingUserId = this.resolveActingUserId(
        currentUser,
        (complex as { ownerId?: string }).ownerId,
      );

      const { chargeId } = await this.dataSource.transaction((em) =>
        this.accountingService.emitPetFineCharge(em, {
          complexId: incident.complexId,
          unitId: incident.unitId,
          amount: input.fineAmount,
          // La multa es ingreso del mes en que se impone, no del mes del hecho.
          period: this.periodOf(now),
          dueDate: new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59,
            999,
          ),
          documentDate: now,
          // El número del expediente viaja hasta el estado de cuenta: la unidad
          // sabe qué le están cobrando y puede pedir el soporte.
          description: `Multa de convivencia ${incident.code} — ${notes}`,
          createdByUserId: actingUserId,
        }),
      );

      incident.fineAmount = input.fineAmount;
      incident.fineChargeId = chargeId;
      incident.status = PetIncidentStatus.FINED;
    } else {
      incident.status = PetIncidentStatus.WARNED;
    }

    incident.resolutionNotes = notes;
    incident.resolvedAt = now;

    const saved = await this.incidentRepo.save(incident);

    // La reincidencia se cuenta y se dice: el residente tiene que saber que
    // esta es la segunda vez, porque de eso depende la sanción de la próxima.
    const priorSanctions = await this.countSanctionsByUnit(
      saved.unitId,
      saved.id,
    );
    const recurrenceNote =
      priorSanctions > 0
        ? ` Es la sanción número ${priorSanctions + 1} para tu unidad por convivencia con mascotas.`
        : '';

    const isFine = saved.status === PetIncidentStatus.FINED;

    this.notifyUnit(
      saved,
      isFine
        ? NotificationType.PET_FINE_CHARGED
        : NotificationType.PET_WARNING_ISSUED,
      NotificationPriority.HIGH,
      isFine
        ? `Multa por el reporte ${saved.code}`
        : `Llamado de atención por el reporte ${saved.code}`,
      isFine
        ? `Se cargó a tu unidad una multa de ${this.formatMoney(saved.fineAmount ?? 0)} por el reporte ${saved.code}. ${notes}${recurrenceNote}`
        : `Tu unidad recibió un llamado de atención por el reporte ${saved.code}. ${notes}${recurrenceNote}`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar la sanción de ${saved.code}: ${err?.message}`,
      ),
    );

    this.emitUpdate(saved);

    void this.auditService.log({
      entityType: AuditEntityType.PetIncident,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: { status: PetIncidentStatus.UNDER_DEFENSE },
      newValue: {
        status: saved.status,
        fineAmount: saved.fineAmount,
        fineChargeId: saved.fineChargeId,
        resolutionNotes: saved.resolutionNotes,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: isFine
        ? `Multa de ${this.formatMoney(saved.fineAmount ?? 0)} por el reporte ${saved.code}`
        : `Llamado de atención por el reporte ${saved.code}`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DESCARGOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * La unidad señalada responde. Solo puede hacerlo dentro del plazo y solo
   * quien vive en la unidad acusada: los descargos son de quien se defiende.
   */
  async addStatement(
    input: CreatePetIncidentStatementInput,
    currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    const incident = await this.findByIdOrFail(input.incidentId);
    await this.complexService.findById(incident.complexId, currentUser);

    if (incident.status !== PetIncidentStatus.UNDER_DEFENSE) {
      throw new CustomError({
        message:
          'Solo se pueden presentar descargos mientras el reporte está en plazo',
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_INCIDENT_INVALID_STATUS,
      });
    }

    if (incident.statementDueAt && new Date() > incident.statementDueAt) {
      throw new CustomError({
        message: 'El plazo para presentar descargos ya venció',
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_INCIDENT_STATEMENT_WINDOW_CLOSED,
      });
    }

    const resident =
      await this.residentsService.findActiveResidentByUserIdInternal(
        currentUser.sub,
        incident.complexId,
      );

    if (!resident || resident.unitId !== incident.unitId) {
      throw new CustomError({
        message: 'Solo la unidad señalada puede presentar descargos',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: PetErrorCode.PET_INCIDENT_ACCESS_DENIED,
      });
    }

    const authorName = resident.user
      ? `${resident.user.name ?? ''} ${resident.user.lastName ?? ''}`.trim()
      : null;

    await this.statementRepo.save(
      this.statementRepo.create({
        incidentId: incident.id,
        complexId: incident.complexId,
        text: input.text.trim(),
        isDefense: true,
        authorUserId: currentUser.sub,
        authorRole: currentUser.roles?.[0] ?? null,
        authorName: authorName || currentUser.email || null,
      }),
    );

    this.notifyManagers(
      incident,
      NotificationType.PET_STATEMENT_RECEIVED,
      NotificationPriority.NORMAL,
      `Descargos en el reporte ${incident.code}`,
      'La unidad señalada respondió. El caso ya se puede resolver.',
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar los descargos de ${incident.code}: ${err?.message}`,
      ),
    );

    this.emitUpdate(incident);

    void this.auditService.log({
      entityType: AuditEntityType.PetIncident,
      entityId: incident.id,
      action: AuditAction.UPDATE,
      newValue: { statementBy: currentUser.sub },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: incident.complexId,
      description: `Descargos presentados en el reporte ${incident.code}`,
    });

    return this.findById(incident.id, currentUser);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSULTAS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bandeja de reportes.
   *
   * El residente ve lo que él radicó y lo que se abrió contra su unidad —una
   * vez validado—. No ve los reportes de otros vecinos ni los que siguen sin
   * revisar: un reporte sin revisar es una acusación sin verificar.
   */
  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterPetIncidentsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedPetIncidentsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;
    const isStaff = this.isStaff(currentUser);

    const qb = this.incidentRepo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.pet', 'pet')
      .leftJoinAndSelect('i.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .where('i.complexId = :complexId', { complexId })
      .andWhere('i.deletedAt IS NULL');

    if (!isStaff) {
      const resident =
        await this.residentsService.findActiveResidentByUserIdInternal(
          currentUser.sub,
          complexId,
        );

      qb.andWhere(
        '(i.reported_by_user_id = :me OR (i.unit_id = :myUnit AND i.status != :reported))',
        {
          me: currentUser.sub,
          myUnit: resident?.unitId ?? null,
          reported: PetIncidentStatus.REPORTED,
        },
      );
    }

    if (filters?.status) {
      qb.andWhere('i.status = :status', { status: filters.status });
    }
    if (filters?.type) {
      qb.andWhere('i.type = :type', { type: filters.type });
    }
    if (filters?.severity) {
      qb.andWhere('i.severity = :severity', { severity: filters.severity });
    }
    if (filters?.petId) {
      qb.andWhere('i.petId = :petId', { petId: filters.petId });
    }
    if (filters?.unitId && isStaff) {
      qb.andWhere('i.unitId = :unitId', { unitId: filters.unitId });
    }
    if (filters?.onlyUnidentified === 'true') {
      qb.andWhere('i.pet_id IS NULL');
    }
    if (filters?.dateFrom) {
      qb.andWhere('i.occurredAt >= :dateFrom', {
        dateFrom: new Date(filters.dateFrom),
      });
    }
    if (filters?.dateTo) {
      qb.andWhere('i.occurredAt <= :dateTo', {
        dateTo: new Date(filters.dateTo),
      });
    }
    if (filters?.search) {
      qb.andWhere('(i.code ILIKE :search OR i.description ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }

    qb.orderBy('i.createdAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items: items.map((item) => this.maskReporter(item, currentUser, isStaff)),
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findById(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    const incident = await this.incidentRepo.findOne({
      where: { id },
      relations: [
        'pet',
        'unit',
        'unit.building',
        'statements',
        'statements.author',
      ],
    });

    if (!incident) {
      throw new CustomError({
        message: `Reporte con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: PetErrorCode.PET_INCIDENT_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(
      incident.complexId,
      currentUser,
    );

    const isStaff = this.isStaff(currentUser);

    if (!isStaff) {
      const resident =
        await this.residentsService.findActiveResidentByUserIdInternal(
          currentUser.sub,
          incident.complexId,
        );

      const isReporter = incident.reportedByUserId === currentUser.sub;
      const isAccusedUnit =
        !!resident &&
        resident.unitId === incident.unitId &&
        incident.status !== PetIncidentStatus.REPORTED;

      if (!isReporter && !isAccusedUnit) {
        throw new CustomError({
          message: 'No tienes acceso a este reporte',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: PetErrorCode.PET_INCIDENT_ACCESS_DENIED,
        });
      }
    }

    return this.maskReporter(incident, currentUser, isStaff);
  }

  /** Historial de una mascota: lo que sostiene la escalada por reincidencia. */
  async findByPet(
    petId: string,
    currentUser: JwtAccessPayload,
  ): Promise<PetIncident[]> {
    const pet = await this.petRepo.findOne({ where: { id: petId } });

    if (!pet) {
      throw new CustomError({
        message: `Mascota con ID "${petId}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: PetErrorCode.PET_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(pet.complexId, currentUser);
    const isStaff = this.isStaff(currentUser);

    if (!isStaff) {
      const resident =
        await this.residentsService.findActiveResidentByUserIdInternal(
          currentUser.sub,
          pet.complexId,
        );
      if (!resident || resident.unitId !== pet.unitId) {
        throw new CustomError({
          message: 'No tienes acceso al historial de esta mascota',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: PetErrorCode.PET_INCIDENT_ACCESS_DENIED,
        });
      }
    }

    const incidents = await this.incidentRepo.find({
      where: isStaff
        ? { petId }
        : {
            petId,
            status: In([
              PetIncidentStatus.UNDER_DEFENSE,
              PetIncidentStatus.DISMISSED,
              PetIncidentStatus.WARNED,
              PetIncidentStatus.FINED,
            ]),
          },
      relations: ['unit'],
      order: { createdAt: 'DESC' },
    });

    return incidents.map((incident) =>
      this.maskReporter(incident, currentUser, isStaff),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private isStaff(user: JwtAccessPayload): boolean {
    return user.roles?.some((role) => STAFF_ROLES.includes(role)) ?? false;
  }

  private assertManager(user: JwtAccessPayload): void {
    const canManage =
      user.roles?.some((role) => MANAGER_ROLES.includes(role)) ?? false;

    if (!canManage) {
      throw new CustomError({
        message: 'No tienes permisos para gestionar reportes de convivencia',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }

  /**
   * La sanción espera a que la unidad haya podido defenderse. Si ya presentó
   * descargos no tiene sentido seguir esperando: ya fue oída.
   *
   * Solo cuentan los DESCARGOS: la observación que la administración deja al
   * dar curso vive en el mismo hilo, y contarla cerraba el plazo en el acto.
   */
  private async assertDefenseWindowClosed(
    incident: PetIncident,
  ): Promise<void> {
    const answered = await this.statementRepo.count({
      where: { incidentId: incident.id, isDefense: true },
    });
    if (answered > 0) return;

    if (incident.statementDueAt && new Date() < incident.statementDueAt) {
      throw new CustomError({
        message: `La unidad tiene plazo para presentar descargos hasta el ${this.formatDate(incident.statementDueAt)}. No se puede sancionar antes`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_INCIDENT_DEFENSE_WINDOW_OPEN,
      });
    }
  }

  /**
   * Resuelve a qué mascota y a qué unidad apunta el reporte. La unidad sale de
   * la mascota cuando hay mascota: es la fuente confiable, no lo que escribió
   * quien reporta.
   */
  private async resolveTarget(
    complexId: string,
    petId: string | undefined | null,
    unitId: string | undefined | null,
    currentUser: JwtAccessPayload,
  ): Promise<{ petId?: string; unitId?: string }> {
    if (petId) {
      const pet = await this.petRepo.findOne({ where: { id: petId } });

      if (!pet || pet.complexId !== complexId) {
        throw new CustomError({
          message: 'La mascota señalada no pertenece a este complejo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: PetErrorCode.PET_COMPLEX_MISMATCH,
        });
      }

      return { petId: pet.id, unitId: pet.unitId };
    }

    if (unitId) {
      const unit = await this.unitService.findById(unitId, currentUser);
      if (unit.complexId !== complexId) {
        throw new CustomError({
          message: 'La unidad señalada no pertenece a este complejo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: PetErrorCode.PET_COMPLEX_MISMATCH,
        });
      }
      return { unitId };
    }

    return {};
  }

  /**
   * Le quita a quien no es administración los datos de quien reportó.
   *
   * Es la regla que sostiene el módulo: el vecino reporta sabiendo que su
   * nombre no le llega al acusado. Sin esto, nadie reporta —o el que reporta
   * termina teniendo el problema—.
   */
  private maskReporter(
    incident: PetIncident,
    currentUser: JwtAccessPayload,
    isStaff: boolean,
  ): PetIncident {
    if (isStaff) return incident;
    if (incident.reportedByUserId === currentUser.sub) return incident;

    incident.reportedByUserId = null;
    incident.reportedByName = null;
    incident.reportedByRole = null;
    incident.reportedByUnitId = null;
    return incident;
  }

  private async countSanctionsByUnit(
    unitId: string,
    excludeIncidentId: string,
  ): Promise<number> {
    const total = await this.incidentRepo.count({
      where: SANCTIONED_STATES.map((status) => ({ unitId, status })),
    });

    // El caso que se acaba de sancionar ya está guardado: no se cuenta dos veces.
    const current = await this.incidentRepo.count({
      where: SANCTIONED_STATES.map((status) => ({
        id: excludeIncidentId,
        status,
      })),
    });

    return Math.max(total - current, 0);
  }

  private async findByIdOrFail(id: string): Promise<PetIncident> {
    const incident = await this.incidentRepo.findOne({ where: { id } });

    if (!incident) {
      throw new CustomError({
        message: `Reporte con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: PetErrorCode.PET_INCIDENT_NOT_FOUND,
      });
    }

    return incident;
  }

  private async notifyUnit(
    incident: PetIncident,
    type: NotificationType,
    priority: NotificationPriority,
    title: string,
    body: string,
  ): Promise<void> {
    if (!incident.unitId) return;

    const residents = await this.residentsService.findActiveByUnitInternal(
      incident.unitId,
    );
    const userIds = residents.map((r) => r.userId).filter(Boolean);
    if (userIds.length === 0) {
      // Sin residentes activos en la unidad el aviso no tiene a quién llegar.
      // Antes se cortaba sin rastro y parecía que la sanción no notificaba.
      this.logger.warn(
        `[${type}] ${incident.code}: la unidad ${incident.unitId} no tiene residentes activos; no se notificó a nadie`,
      );
      return;
    }

    await this.notificationsService.notify({
      complexId: incident.complexId,
      userIds,
      type,
      priority,
      title,
      body,
      entityId: incident.id,
      entityType: 'pet_incident',
      metadata: {
        incidentId: incident.id,
        code: incident.code,
        type: incident.type,
        status: incident.status,
        petId: incident.petId,
        unitId: incident.unitId,
      },
    });
  }

  private async notifyManagers(
    incident: PetIncident,
    type: NotificationType,
    priority: NotificationPriority,
    title: string,
    body: string,
  ): Promise<void> {
    const userIds = await this.notificationsService.findUserIdsByRoles(
      incident.complexId,
      [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    );
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: incident.complexId,
      userIds,
      type,
      priority,
      title,
      body,
      entityId: incident.id,
      entityType: 'pet_incident',
      isActionable: true,
      metadata: {
        incidentId: incident.id,
        code: incident.code,
        type: incident.type,
        status: incident.status,
      },
    });
  }

  private emitUpdate(incident: PetIncident): void {
    const payload = { incidentId: incident.id, status: incident.status };

    this.socketService.emitToComplex(
      incident.complexId,
      SocketEvent.PET_INCIDENT_UPDATED,
      payload,
    );

    // El residente NO está en la sala del complejo —ahí escuchan la
    // administración y la portería—, así que sin este segundo envío la unidad
    // señalada no se entera de nada en caliente. Y justo ahí importa: al
    // validarse el reporte empieza a correr su plazo de descargos.
    if (incident.unitId) {
      this.socketService.emitToUnit(
        incident.unitId,
        SocketEvent.PET_INCIDENT_UPDATED,
        payload,
      );
    }
  }

  private resolveActingUserId(
    user: JwtAccessPayload,
    ownerId?: string | null,
  ): string {
    // La cuenta del complejo no es un usuario: su `sub` es el complexId, así
    // que como autor del documento contable va el dueño registrado.
    return user.entityType === 'user' ? user.sub : (ownerId ?? user.sub);
  }

  private describeType(incident: PetIncident): string {
    return `${incident.type} · gravedad ${incident.severity}`;
  }

  private periodOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Bogota',
    }).format(new Date(date));
  }

  private formatMoney(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
