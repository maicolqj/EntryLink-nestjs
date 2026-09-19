import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import { MaintenanceTicket } from '../entities/maintenance-ticket.entity';
import { MaintenanceTicketEvent } from '../entities/maintenance-ticket-event.entity';
import { MaintenanceEndorsement } from '../entities/maintenance-endorsement.entity';

import { MaintenanceTicketStatus } from '../enums/maintenance-ticket-status.enum';
import { MaintenancePriority } from '../enums/maintenance-priority.enum';
import { MaintenanceEventType } from '../enums/maintenance-event-type.enum';
import { MaintenanceLocationType } from '../enums/maintenance-location-type.enum';
import { MaintenanceAssigneeType } from '../enums/maintenance-assignee-type.enum';
import { MaintenanceVisibility } from '../enums/maintenance-visibility.enum';
import { MaintenanceCategory } from '../enums/maintenance-category.enum';

import { CreateMaintenanceTicketDto } from '../dto/inputs/create-maintenance-ticket.input';
import { ResolveMaintenanceTicketDto } from '../dto/inputs/resolve-maintenance-ticket.input';
import { TriageMaintenanceTicketInput } from '../dto/inputs/triage-maintenance-ticket.input';
import { AssignMaintenanceTicketInput } from '../dto/inputs/assign-maintenance-ticket.input';
import { ChangeMaintenanceStatusInput } from '../dto/inputs/change-maintenance-status.input';
import { AddMaintenanceCommentInput } from '../dto/inputs/add-maintenance-comment.input';
import { RateMaintenanceTicketInput } from '../dto/inputs/rate-maintenance-ticket.input';
import { FilterMaintenanceTicketsInput } from '../dto/inputs/filter-maintenance-tickets.input';
import { PaginatedMaintenanceTicketsResponse } from '../dto/responses/paginated-maintenance-tickets.response';
import {
  MaintenanceBoardColumn,
  MaintenanceBoardResponse,
} from '../dto/responses/maintenance-board.response';
import { MaintenanceMapPinResponse } from '../dto/responses/maintenance-map-pin.response';
import { MaintenanceHeatmapCell } from '../dto/responses/maintenance-heatmap.response';
import { MaintenanceStatsResponse } from '../dto/responses/maintenance-stats.response';

import { MaintenanceLocationsService } from './maintenance-locations.service';
import { MaintenanceVendorsService } from './maintenance-vendors.service';
import { MaintenanceSlaService } from './maintenance-sla.service';
import {
  ALLOWED_MANUAL_TRANSITIONS,
  FINAL_TICKET_STATUSES,
  OPEN_TICKET_STATUSES,
  isMaintenanceModuleEnabled,
  isPreciseLocation,
} from '../utils/maintenance-status.util';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  MaintenanceErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { calculateHaversineDistance } from '../../shared/utils/gps.utils';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { User } from '../../users/entities/user.entity';
import {
  AssignmentStatus,
  UserComplexAssignment,
} from '../../users/entities/user-complex-assignment.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { MaintenanceStaffMember } from '../dto/responses/maintenance-staff-member.response';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';

/** Datos de radicación: el DTO del REST más la evidencia ya subida a R2. */
export type CreateTicketData = CreateMaintenanceTicketDto & {
  photoUrls: string[];
  photoHashes: string[];
  videoUrl?: string | null;
  videoHash?: string | null;
};

export type ResolveTicketData = ResolveMaintenanceTicketDto & {
  photoUrls: string[];
  photoHashes: string[];
};

/** Quien gestiona el tablero. */
const MANAGER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
];

/** Quien además lee todo el tablero: la portería reporta y hace seguimiento. */
const STAFF_ROLES = [...MANAGER_ROLES, ValidRoles.SECURITY_ROL];

/** Radio en metros dentro del cual dos reportes GPS son el mismo daño. */
const DUPLICATE_RADIUS_METERS = 15;

/** Cuántas tarjetas trae cada columna del Kanban antes de paginar. */
const BOARD_COLUMN_LIMIT = 25;

@Injectable()
export class MaintenanceTicketsService {
  private readonly logger = new Logger(MaintenanceTicketsService.name);

  constructor(
    @InjectRepository(MaintenanceTicket)
    private readonly ticketRepo: Repository<MaintenanceTicket>,
    @InjectRepository(MaintenanceTicketEvent)
    private readonly eventRepo: Repository<MaintenanceTicketEvent>,
    @InjectRepository(MaintenanceEndorsement)
    private readonly endorsementRepo: Repository<MaintenanceEndorsement>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly locationsService: MaintenanceLocationsService,
    private readonly vendorsService: MaintenanceVendorsService,
    private readonly slaService: MaintenanceSlaService,
    private readonly complexService: ResidentialComplexService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly socketService: SocketService,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // RADICAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Abre el ticket con su evidencia y su ubicación ya verificadas.
   *
   * El SLA arranca aquí y no en la revisión: el residente empezó a esperar
   * cuando reportó, no cuando la administración se dignó a mirar. Si el plazo
   * naciera con el triage, dejar los tickets sin revisar sería la forma más
   * fácil de no incumplir nunca.
   */
  async create(
    data: CreateTicketData,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const complex = await this.complexService.findById(
      data.complexId,
      currentUser,
    );
    const isStaff = this.isStaff(currentUser);

    if (!isMaintenanceModuleEnabled(complex)) {
      throw new CustomError({
        message:
          'El módulo de mantenimiento no está habilitado en este complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MaintenanceErrorCode.MAINTENANCE_MODULE_DISABLED,
      });
    }

    if (!isStaff && !complex.maintenanceResidentReportingEnabled) {
      throw new CustomError({
        message:
          'En este complejo los reportes de mantenimiento los radica la administración o la portería',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MaintenanceErrorCode.MAINTENANCE_REPORTING_DISABLED,
      });
    }

    // Al residente se le exige evidencia; al personal no. El administrador que
    // radica lo que le contaron por teléfono no tiene cómo fotografiarlo, y
    // obligarlo a inventar una foto vacía es peor que un ticket sin foto.
    if (!isStaff && !data.photoUrls?.length && !data.videoUrl) {
      throw new CustomError({
        message: 'Adjunta al menos una foto o un video del daño',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_EVIDENCE_REQUIRED,
      });
    }

    const now = new Date();
    const occurredAt = data.occurredAt ? new Date(data.occurredAt) : now;

    // Un minuto de tolerancia por el desfase del reloj del celular.
    if (occurredAt.getTime() > now.getTime() + 60_000) {
      throw new CustomError({
        message: 'La fecha del hecho no puede estar en el futuro',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_OCCURRED_IN_FUTURE,
      });
    }

    const location = await this.locationsService.resolveLocation(
      data,
      complex,
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

    const priority = data.priority ?? MaintenancePriority.MEDIUM;
    const slaHours = await this.slaService.resolveHours(
      data.complexId,
      data.category,
      priority,
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      // El bloqueo serializa solo a quienes radican en ESTE complejo y se
      // libera al terminar la transacción: dos vecinos reportando en el mismo
      // segundo no pueden llevarse el mismo número de ticket.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `maintenance-ticket:${data.complexId}`,
      ]);

      const last = await manager
        .createQueryBuilder(MaintenanceTicket, 't')
        .select('MAX(t.consecutive)', 'max')
        .where('t.complexId = :complexId', { complexId: data.complexId })
        .getRawOne<{ max: number | null }>();

      const consecutive = (last?.max ?? 0) + 1;

      return manager.save(
        manager.create(MaintenanceTicket, {
          complexId: data.complexId,
          consecutive,
          code: `MTO-${String(consecutive).padStart(6, '0')}`,
          title: data.title.trim(),
          description: data.description.trim(),
          category: data.category,
          priority,
          visibility: data.visibility ?? MaintenanceVisibility.PUBLIC,
          photoUrls: data.photoUrls ?? [],
          photoHashes: data.photoHashes ?? [],
          videoUrl: data.videoUrl ?? null,
          videoHash: data.videoHash ?? null,
          occurredAt,
          ...location,
          status: MaintenanceTicketStatus.NEW,
          slaHours,
          slaDueAt: this.slaService.dueAtFrom(now, slaHours),
          reportedByUserId:
            currentUser.entityType === 'user' ? currentUser.sub : null,
          reportedByRole: currentUser.roles?.[0] ?? null,
          reportedByName: reporterName || currentUser.email || null,
          reportedByUnitId: reporter?.unitId ?? null,
        }),
      );
    });

    await this.addEvent(saved, {
      type: MaintenanceEventType.CREATED,
      toStatus: saved.status,
      message: saved.title,
      currentUser,
    });

    this.logger.log(
      `Ticket de mantenimiento radicado: ${saved.code} — complejo ${data.complexId}`,
    );

    // El aviso se arma con las relaciones cargadas, no con la entidad que
    // devolvió el save: ahí `building`, `amenity` y `locationTag` vienen vacíos
    // y el administrador recibía "Zona común" en vez de "Torre 2 · Sótano 1".
    // Quien atiende el reporte necesita saber a dónde ir desde la notificación,
    // sin tener que abrir el tablero.
    const enriched = await this.loadRelations(saved);

    this.notifyManagers(
      enriched,
      NotificationType.MAINTENANCE_TICKET_REPORTED,
      saved.priority === MaintenancePriority.CRITICAL
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL,
      `Nuevo reporte ${enriched.code}`,
      `${enriched.title} — ${this.describeLocation(enriched)}`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar el ticket ${saved.code}: ${err?.message}`,
      ),
    );

    this.emitUpdate(enriched);

    void this.auditService.log({
      entityType: AuditEntityType.MaintenanceTicket,
      entityId: saved.id,
      action: AuditAction.CREATE,
      newValue: {
        code: saved.code,
        category: saved.category,
        priority: saved.priority,
        locationType: saved.locationType,
        evidence: saved.photoUrls.length + (saved.videoUrl ? 1 : 0),
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Ticket de mantenimiento radicado ${saved.code}`,
    });

    return enriched;
  }

  /**
   * Tickets abiertos que probablemente sean el mismo daño.
   *
   * Se consulta ANTES de crear: cuando el ascensor se para, treinta vecinos
   * abren treinta tickets y el tablero deja de servir. La app muestra estos
   * candidatos y ofrece adherirse en vez de radicar otro.
   */
  async findDuplicateCandidates(
    complexId: string,
    category: MaintenanceCategory,
    raw: {
      locationType: MaintenanceLocationType;
      locationTagCode?: string | null;
      buildingId?: string | null;
      floor?: number | null;
      amenityId?: string | null;
      lat?: number | null;
      lng?: number | null;
    },
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket[]> {
    const complex = await this.complexService.findById(complexId, currentUser);

    const location = await this.locationsService.resolveLocation(
      raw,
      complex,
      currentUser,
    );

    const windowHours = complex.maintenanceDuplicateWindowHours ?? 48;
    const since = new Date(Date.now() - windowHours * 3_600_000);

    const qb = this.ticketRepo
      .createQueryBuilder('t')
      .where('t.complexId = :complexId', { complexId })
      .andWhere('t.category = :category', { category })
      .andWhere('t.status IN (:...statuses)', {
        statuses: OPEN_TICKET_STATUSES,
      })
      .andWhere('t.createdAt >= :since', { since })
      .andWhere('t.deletedAt IS NULL')
      .orderBy('t.createdAt', 'DESC')
      .take(10);

    if (location.locationTagId) {
      qb.andWhere('t.locationTagId = :tagId', {
        tagId: location.locationTagId,
      });
    } else if (location.amenityId) {
      qb.andWhere('t.amenityId = :amenityId', {
        amenityId: location.amenityId,
      });
    } else if (location.buildingId) {
      qb.andWhere('t.buildingId = :buildingId', {
        buildingId: location.buildingId,
      });
      if (location.floor != null) {
        qb.andWhere('t.floor = :floor', { floor: location.floor });
      }
    }

    const candidates = await qb.getMany();

    // Con GPS la cercanía se calcula en memoria: son diez filas como mucho y
    // PostGIS no está instalado. Meter una extensión por esto sería pagar una
    // migración de infraestructura para filtrar una lista corta.
    if (
      !location.locationTagId &&
      !location.amenityId &&
      !location.buildingId &&
      location.lat != null &&
      location.lng != null
    ) {
      return candidates.filter((ticket) => {
        if (ticket.lat == null || ticket.lng == null) return false;
        const distance = calculateHaversineDistance(
          Number(location.lat),
          Number(location.lng),
          Number(ticket.lat),
          Number(ticket.lng),
        );
        return distance <= DUPLICATE_RADIUS_METERS;
      });
    }

    return candidates;
  }

  /**
   * "A mí también me pasa". Suma al contador y deja constancia en la bitácora
   * sin abrir otro ticket.
   */
  async endorse(
    ticketId: string,
    comment: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(ticketId);
    await this.complexService.assertComplexAccess(
      ticket.complexId,
      currentUser,
    );

    if (FINAL_TICKET_STATUSES.includes(ticket.status)) {
      throw new CustomError({
        message: 'El ticket ya está cerrado: radica uno nuevo si el daño sigue',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_ENDORSE_CLOSED,
      });
    }

    if (ticket.reportedByUserId === currentUser.sub) {
      throw new CustomError({
        message: 'Ya reportaste este daño',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_ALREADY_ENDORSED,
      });
    }

    const existing = await this.endorsementRepo.findOne({
      where: { ticketId: ticket.id, userId: currentUser.sub },
    });

    if (existing) {
      throw new CustomError({
        message: 'Ya te habías sumado a este reporte',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_ALREADY_ENDORSED,
      });
    }

    const resident =
      await this.residentsService.findActiveResidentByUserIdInternal(
        currentUser.sub,
        ticket.complexId,
      );

    await this.endorsementRepo.save(
      this.endorsementRepo.create({
        ticketId: ticket.id,
        userId: currentUser.sub,
        unitId: resident?.unitId ?? null,
        comment: comment?.trim() || null,
        complexId: ticket.complexId,
      }),
    );

    // El contador se actualiza en la base y no en memoria: dos vecinos
    // sumándose a la vez con `count + 1` en JavaScript dejarían el marcador en
    // uno.
    await this.ticketRepo.increment({ id: ticket.id }, 'endorsementCount', 1);

    const updated = await this.findByIdOrFail(ticket.id);

    await this.addEvent(updated, {
      type: MaintenanceEventType.ENDORSED,
      message: comment?.trim() || 'Un vecino confirmó el mismo daño',
      currentUser,
    });

    this.emitUpdate(updated);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRÁMITE DE LA ADMINISTRACIÓN
  // ═══════════════════════════════════════════════════════════════════════════

  /** Revisión inicial: corrige la clasificación y fija el plazo definitivo. */
  async triage(
    input: TriageMaintenanceTicketInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(input.ticketId);
    await this.complexService.findById(ticket.complexId, currentUser);
    this.assertManager(currentUser);

    if (ticket.status !== MaintenanceTicketStatus.NEW) {
      throw new CustomError({
        message: `El ticket ya fue revisado. Estado actual: ${ticket.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
      });
    }

    const previous = {
      category: ticket.category,
      priority: ticket.priority,
      slaDueAt: ticket.slaDueAt,
    };

    ticket.category = input.category ?? ticket.category;
    ticket.priority = input.priority ?? ticket.priority;
    ticket.visibility = input.visibility ?? ticket.visibility;
    ticket.status = MaintenanceTicketStatus.TRIAGED;
    ticket.triagedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;
    ticket.triagedAt = new Date();

    // El plazo se recalcula desde la RADICACIÓN, no desde ahora: el reloj del
    // residente empezó a correr cuando reportó. Recalcularlo desde el triage
    // premiaría a quien se demora en revisar.
    const slaHours =
      input.slaHours ??
      (await this.slaService.resolveHours(
        ticket.complexId,
        ticket.category,
        ticket.priority,
      ));

    ticket.slaHours = slaHours;
    ticket.slaDueAt = this.slaService.dueAtFrom(ticket.createdAt, slaHours);

    const saved = await this.ticketRepo.save(ticket);

    await this.addEvent(saved, {
      type: MaintenanceEventType.TRIAGED,
      fromStatus: MaintenanceTicketStatus.NEW,
      toStatus: saved.status,
      message: input.notes?.trim() || null,
      currentUser,
    });

    this.notifyReporter(
      saved,
      NotificationType.MAINTENANCE_TICKET_UPDATED,
      NotificationPriority.NORMAL,
      `Tu reporte ${saved.code} está en revisión`,
      `${saved.title} — la administración lo clasificó y le asignó un plazo de atención.`,
    ).catch(() => undefined);

    this.emitUpdate(saved);

    void this.auditService.log({
      entityType: AuditEntityType.MaintenanceTicket,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: previous,
      newValue: {
        category: saved.category,
        priority: saved.priority,
        slaDueAt: saved.slaDueAt,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Ticket ${saved.code} revisado`,
    });

    return saved;
  }

  /** Personal de aseo y mantenimiento activo del complejo, para asignar tickets. */
  async findMaintenanceStaff(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceStaffMember[]> {
    await this.complexService.findById(complexId, currentUser);

    const users = await this.maintenanceStaffQuery(complexId)
      .orderBy('u.name', 'ASC')
      .addOrderBy('u.lastName', 'ASC')
      .getMany();

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
    }));
  }

  /**
   * Usuarios con asignación ACTIVA de MAINTENANCE_ROL en el complejo. La
   * asignación manda, no `users.complex_id`: el personal puede estar en varios
   * complejos y quitarlo de uno deja la asignación en REMOVED.
   */
  private maintenanceStaffQuery(complexId: string) {
    return this.userRepo
      .createQueryBuilder('u')
      .innerJoin(
        UserComplexAssignment,
        'a',
        'a.userId = u.id AND a.complexId = :complexId AND a.role = :role AND a.status = :assignmentStatus',
        {
          complexId,
          role: ValidRoles.MAINTENANCE_ROL,
          assignmentStatus: AssignmentStatus.ACTIVE,
        },
      )
      .where('u.status = :userStatus', { userStatus: UserStatus.ACTIVE });
  }

  /** Asigna responsable —interno o proveedor— y fecha estimada de visita. */
  async assign(
    input: AssignMaintenanceTicketInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(input.ticketId);
    await this.complexService.findById(ticket.complexId, currentUser);
    this.assertManager(currentUser);

    if (FINAL_TICKET_STATUSES.includes(ticket.status)) {
      throw new CustomError({
        message: `El ticket ya está cerrado. Estado actual: ${ticket.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
      });
    }

    const isInternal = input.assigneeType === MaintenanceAssigneeType.INTERNAL;
    const targetId = isInternal ? input.assignedUserId : input.vendorId;

    if (!targetId) {
      throw new CustomError({
        message: isInternal
          ? 'Indica el miembro del personal que atenderá el ticket'
          : 'Indica el proveedor que atenderá el ticket',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_ASSIGNEE_REQUIRED,
      });
    }

    // Un ticket con dos dueños no tiene dueño: cada uno da por hecho que lo
    // atiende el otro.
    if (input.assignedUserId && input.vendorId) {
      throw new CustomError({
        message: 'Asigna a personal interno o a un proveedor, no a los dos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_ASSIGNEE_CONFLICT,
      });
    }

    let assigneeLabel: string;

    if (isInternal) {
      // Solo personal de aseo y mantenimiento activo en el complejo: es lo que
      // el tablero ofrece, y cualquier otro id sería un ticket sin quien lo
      // atienda.
      const user = await this.maintenanceStaffQuery(ticket.complexId)
        .andWhere('u.id = :userId', { userId: input.assignedUserId })
        .getOne();

      if (!user) {
        throw new CustomError({
          message:
            'La persona asignada no es personal de aseo y mantenimiento activo en este complejo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: MaintenanceErrorCode.MAINTENANCE_ASSIGNEE_NOT_IN_COMPLEX,
        });
      }

      assigneeLabel =
        `${user.name ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
      ticket.assignedUserId = user.id;
      ticket.vendorId = null;
    } else {
      const vendor = await this.vendorsService.findByIdOrFail(input.vendorId);

      if (vendor.complexId !== ticket.complexId) {
        throw new CustomError({
          message: 'El proveedor no pertenece a este complejo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: MaintenanceErrorCode.MAINTENANCE_ASSIGNEE_NOT_IN_COMPLEX,
        });
      }

      if (!vendor.isActive) {
        throw new CustomError({
          message: `El proveedor ${vendor.name} está desactivado`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: MaintenanceErrorCode.MAINTENANCE_VENDOR_INACTIVE,
        });
      }

      assigneeLabel = vendor.name;
      ticket.vendorId = vendor.id;
      ticket.assignedUserId = null;
    }

    ticket.assigneeType = input.assigneeType;
    ticket.assignedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;
    ticket.assignedAt = new Date();
    ticket.scheduledFor = input.scheduledFor ?? ticket.scheduledFor ?? null;
    ticket.status = MaintenanceTicketStatus.ASSIGNED;

    const saved = await this.loadRelations(await this.ticketRepo.save(ticket));

    await this.addEvent(saved, {
      type: MaintenanceEventType.ASSIGNED,
      toStatus: saved.status,
      message: input.notes?.trim() || `Asignado a ${assigneeLabel}`,
      currentUser,
    });

    const whenText = saved.scheduledFor
      ? ` Llegada estimada: ${this.formatDateTime(saved.scheduledFor)}.`
      : '';

    this.notifyReporter(
      saved,
      NotificationType.MAINTENANCE_TICKET_ASSIGNED,
      NotificationPriority.NORMAL,
      `${saved.code}: ya hay técnico asignado`,
      `${saved.title} — quedó a cargo de ${assigneeLabel}.${whenText}`,
    ).catch(() => undefined);

    // Al interno se le avisa aparte: es trabajo suyo, no seguimiento.
    if (saved.assignedUserId) {
      this.notificationsService
        .notify({
          complexId: saved.complexId,
          userIds: [saved.assignedUserId],
          type: NotificationType.MAINTENANCE_TICKET_ASSIGNED,
          priority: NotificationPriority.HIGH,
          title: `Te asignaron el ticket ${saved.code}`,
          body: `${saved.title} — ${this.describeLocation(saved)}`,
          entityId: saved.id,
          entityType: 'maintenance_ticket',
          isActionable: true,
          metadata: this.notificationMetadata(saved),
        })
        .catch(() => undefined);
    }

    this.emitUpdate(saved);

    void this.auditService.log({
      entityType: AuditEntityType.MaintenanceTicket,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      newValue: {
        assigneeType: saved.assigneeType,
        assignedUserId: saved.assignedUserId,
        vendorId: saved.vendorId,
        scheduledFor: saved.scheduledFor,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Ticket ${saved.code} asignado a ${assigneeLabel}`,
    });

    return saved;
  }

  /** Movimiento manual entre columnas del tablero. */
  async changeStatus(
    input: ChangeMaintenanceStatusInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(input.ticketId);
    await this.complexService.findById(ticket.complexId, currentUser);
    this.assertStaffOrAssignee(ticket, currentUser);

    const allowed = ALLOWED_MANUAL_TRANSITIONS[ticket.status] ?? [];

    if (!allowed.includes(input.status)) {
      throw new CustomError({
        message: `No se puede pasar de ${ticket.status} a ${input.status} desde el tablero`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TRANSITION_NOT_ALLOWED,
      });
    }

    if (
      input.status === MaintenanceTicketStatus.ON_HOLD &&
      !input.message?.trim()
    ) {
      throw new CustomError({
        message: 'Explica por qué se detiene el ticket',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_REASON_REQUIRED,
      });
    }

    const from = ticket.status;
    ticket.status = input.status;

    if (input.status === MaintenanceTicketStatus.IN_PROGRESS) {
      ticket.startedAt = ticket.startedAt ?? new Date();
      ticket.onHoldReason = null;
    }
    if (input.status === MaintenanceTicketStatus.ON_HOLD) {
      ticket.onHoldReason = input.message.trim();
    }

    const saved = await this.ticketRepo.save(ticket);

    await this.addEvent(saved, {
      type: MaintenanceEventType.STATUS_CHANGED,
      fromStatus: from,
      toStatus: saved.status,
      message: input.message?.trim() || null,
      currentUser,
    });

    this.notifyReporter(
      saved,
      NotificationType.MAINTENANCE_TICKET_UPDATED,
      NotificationPriority.NORMAL,
      `${saved.code}: ${this.describeStatus(saved.status)}`,
      input.message?.trim() || saved.title,
    ).catch(() => undefined);

    this.emitUpdate(saved);

    return saved;
  }

  /** Comentario o avance en la bitácora. Las fotos entran por el REST. */
  async addComment(
    input: AddMaintenanceCommentInput,
    currentUser: JwtAccessPayload,
    images: { urls: string[]; hashes: string[] } = { urls: [], hashes: [] },
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(input.ticketId);
    await this.complexService.assertComplexAccess(
      ticket.complexId,
      currentUser,
    );

    const isStaff = this.isStaff(currentUser);

    if (!isStaff) {
      await this.assertResidentCanRead(ticket, currentUser);
    }

    await this.addEvent(ticket, {
      type: images.urls.length
        ? MaintenanceEventType.PROGRESS
        : MaintenanceEventType.COMMENT,
      message: input.message.trim(),
      // Un residente no puede escribir notas internas: la marca se ignora en
      // vez de fallar, porque perder un comentario por una casilla mal puesta
      // es peor que publicarlo.
      isInternal: isStaff ? (input.isInternal ?? false) : false,
      imageUrls: images.urls,
      imageHashes: images.hashes,
      currentUser,
    });

    // Solo lo que el residente puede ver le llega como aviso.
    if (isStaff && !input.isInternal) {
      this.notifyReporter(
        ticket,
        NotificationType.MAINTENANCE_TICKET_UPDATED,
        NotificationPriority.LOW,
        `Novedad en ${ticket.code}`,
        input.message.trim(),
      ).catch(() => undefined);
    }

    this.emitUpdate(ticket);

    return this.findByIdOrFail(ticket.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CIERRE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cierre técnico: quien reparó declara el trabajo hecho y lo prueba.
   *
   * La foto de la reparación es obligatoria. Sin ella, "resuelto" es la palabra
   * del que tenía que arreglarlo, y la mitad de las reaperturas salen de
   * tickets que se cerraron sin que nadie fuera al sitio.
   */
  async resolve(
    data: ResolveTicketData,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(data.ticketId);
    await this.complexService.findById(ticket.complexId, currentUser);
    this.assertStaffOrAssignee(ticket, currentUser);

    if (!OPEN_TICKET_STATUSES.includes(ticket.status)) {
      throw new CustomError({
        message: `El ticket no está abierto. Estado actual: ${ticket.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
      });
    }

    if (!data.photoUrls?.length) {
      throw new CustomError({
        message: 'Adjunta al menos una foto de la reparación terminada',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode:
          MaintenanceErrorCode.MAINTENANCE_RESOLUTION_EVIDENCE_REQUIRED,
      });
    }

    const now = new Date();
    const from = ticket.status;

    ticket.status = MaintenanceTicketStatus.RESOLVED;
    ticket.resolutionNotes = data.resolutionNotes.trim();
    ticket.closurePhotoUrls = data.photoUrls;
    ticket.closurePhotoHashes = data.photoHashes ?? [];
    ticket.resolvedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;
    ticket.resolvedAt = now;
    ticket.actualCost = data.actualCost ?? ticket.actualCost ?? null;

    const saved = await this.ticketRepo.save(ticket);

    await this.addEvent(saved, {
      type: MaintenanceEventType.RESOLVED,
      fromStatus: from,
      toStatus: saved.status,
      message: saved.resolutionNotes,
      imageUrls: saved.closurePhotoUrls,
      imageHashes: saved.closurePhotoHashes,
      currentUser,
    });

    this.notifyReporter(
      saved,
      NotificationType.MAINTENANCE_TICKET_RESOLVED,
      NotificationPriority.NORMAL,
      `${saved.code} quedó reparado`,
      `${saved.title} — revisa el trabajo y califica la atención.`,
    ).catch(() => undefined);

    this.emitUpdate(saved);

    void this.auditService.log({
      entityType: AuditEntityType.MaintenanceTicket,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: { status: from },
      newValue: {
        status: saved.status,
        actualCost: saved.actualCost,
        evidence: saved.closurePhotoUrls.length,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Ticket ${saved.code} resuelto`,
    });

    return saved;
  }

  /** No procede: no es zona común, no hay daño, o el reporte es malicioso. */
  async reject(
    ticketId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(ticketId);
    await this.complexService.findById(ticket.complexId, currentUser);
    this.assertManager(currentUser);

    if (!OPEN_TICKET_STATUSES.includes(ticket.status)) {
      throw new CustomError({
        message: `El ticket no está abierto. Estado actual: ${ticket.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
      });
    }

    if (!reason?.trim()) {
      throw new CustomError({
        message: 'Explica por qué se rechaza el reporte',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_REASON_REQUIRED,
      });
    }

    const from = ticket.status;
    ticket.status = MaintenanceTicketStatus.REJECTED;
    ticket.rejectionReason = reason.trim();
    ticket.closedAt = new Date();
    ticket.closedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.ticketRepo.save(ticket);

    await this.addEvent(saved, {
      type: MaintenanceEventType.STATUS_CHANGED,
      fromStatus: from,
      toStatus: saved.status,
      message: saved.rejectionReason,
      currentUser,
    });

    // El motivo le llega tal cual a quien reportó: un rechazo sin explicación
    // es la forma más rápida de que la próxima vez no reporte.
    this.notifyReporter(
      saved,
      NotificationType.MAINTENANCE_TICKET_REJECTED,
      NotificationPriority.NORMAL,
      `${saved.code} no procede`,
      saved.rejectionReason,
    ).catch(() => undefined);

    this.emitUpdate(saved);

    return saved;
  }

  /** Es el mismo daño de otro ticket: se cierra apuntando al original. */
  async markDuplicate(
    ticketId: string,
    originalTicketId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(ticketId);
    await this.complexService.findById(ticket.complexId, currentUser);
    this.assertManager(currentUser);

    if (ticketId === originalTicketId) {
      throw new CustomError({
        message: 'Un ticket no puede ser duplicado de sí mismo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_DUPLICATE_SELF,
      });
    }

    const original = await this.findByIdOrFail(originalTicketId);

    if (original.complexId !== ticket.complexId) {
      throw new CustomError({
        message: 'El ticket original pertenece a otro complejo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_MISMATCH,
      });
    }

    const from = ticket.status;
    ticket.status = MaintenanceTicketStatus.DUPLICATE;
    ticket.duplicateOfTicketId = original.id;
    ticket.closedAt = new Date();
    ticket.closedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.ticketRepo.save(ticket);

    // Quien reportó el duplicado pasa a contar como adhesión del original: su
    // reporte no se pierde, se suma. Si ya estaba adherido, se deja como está.
    if (saved.reportedByUserId) {
      const already = await this.endorsementRepo.findOne({
        where: { ticketId: original.id, userId: saved.reportedByUserId },
      });

      if (!already && original.reportedByUserId !== saved.reportedByUserId) {
        await this.endorsementRepo.save(
          this.endorsementRepo.create({
            ticketId: original.id,
            userId: saved.reportedByUserId,
            unitId: saved.reportedByUnitId ?? null,
            comment: `Reportado también en ${saved.code}`,
            complexId: original.complexId,
          }),
        );
        await this.ticketRepo.increment(
          { id: original.id },
          'endorsementCount',
          1,
        );
      }
    }

    await this.addEvent(saved, {
      type: MaintenanceEventType.STATUS_CHANGED,
      fromStatus: from,
      toStatus: saved.status,
      message: `Duplicado de ${original.code}`,
      currentUser,
    });

    this.notifyReporter(
      saved,
      NotificationType.MAINTENANCE_TICKET_UPDATED,
      NotificationPriority.LOW,
      `${saved.code} ya estaba reportado`,
      `El daño se atiende en el ticket ${original.code}. Te avisamos cuando quede resuelto.`,
    ).catch(() => undefined);

    this.emitUpdate(saved);

    return saved;
  }

  /**
   * Calificar cierra el ticket: es la confirmación de quien reportó.
   *
   * Solo puede calificar quien radicó. Abrirlo a cualquier vecino convertiría
   * la calificación en una encuesta de opinión sobre la administración, que es
   * otra cosa y no cabe en un ticket.
   */
  async rate(
    input: RateMaintenanceTicketInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(input.ticketId);
    await this.complexService.assertComplexAccess(
      ticket.complexId,
      currentUser,
    );

    if (ticket.reportedByUserId !== currentUser.sub) {
      throw new CustomError({
        message: 'Solo quien reportó el daño puede calificar la atención',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MaintenanceErrorCode.MAINTENANCE_RATING_NOT_ALLOWED,
      });
    }

    if (ticket.status !== MaintenanceTicketStatus.RESOLVED) {
      throw new CustomError({
        message: 'Solo se puede calificar un ticket que ya fue reparado',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
      });
    }

    if (ticket.rating != null) {
      throw new CustomError({
        message: 'Este ticket ya fue calificado',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_ALREADY_RATED,
      });
    }

    const now = new Date();
    ticket.rating = input.rating;
    ticket.ratingComment = input.comment?.trim() || null;
    ticket.ratedAt = now;
    ticket.status = MaintenanceTicketStatus.CLOSED;
    ticket.closedAt = now;
    ticket.closedByUserId = currentUser.sub;

    const saved = await this.ticketRepo.save(ticket);

    await this.addEvent(saved, {
      type: MaintenanceEventType.RATED,
      fromStatus: MaintenanceTicketStatus.RESOLVED,
      toStatus: saved.status,
      message: `${input.rating}/5${saved.ratingComment ? ` — ${saved.ratingComment}` : ''}`,
      currentUser,
    });

    // Una calificación baja es información que la administración necesita hoy,
    // no en el informe de fin de mes.
    if (input.rating <= 2) {
      this.notifyManagers(
        saved,
        NotificationType.MAINTENANCE_TICKET_UPDATED,
        NotificationPriority.HIGH,
        `Calificación baja en ${saved.code}`,
        `${input.rating}/5 — ${saved.ratingComment ?? saved.title}`,
      ).catch(() => undefined);
    }

    this.emitUpdate(saved);

    return saved;
  }

  /**
   * Reapertura: el arreglo no sirvió.
   *
   * Con ventana y con tope. Sin límite, un ticket de hace ocho meses vuelve al
   * tablero por un daño nuevo en el mismo sitio y el historial deja de contar
   * lo que pasó: mezcla dos reparaciones distintas en un solo número.
   */
  async reopen(
    ticketId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(ticketId);
    const complex = await this.complexService.findById(
      ticket.complexId,
      currentUser,
    );

    const isStaff = this.isStaff(currentUser);

    if (!isStaff && ticket.reportedByUserId !== currentUser.sub) {
      throw new CustomError({
        message: 'Solo quien reportó el daño puede reabrir el ticket',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_ACCESS_DENIED,
      });
    }

    if (
      ticket.status !== MaintenanceTicketStatus.RESOLVED &&
      ticket.status !== MaintenanceTicketStatus.CLOSED
    ) {
      throw new CustomError({
        message: `Solo se reabre un ticket reparado o cerrado. Estado actual: ${ticket.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
      });
    }

    if (!reason?.trim()) {
      throw new CustomError({
        message: 'Explica qué quedó mal',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_REASON_REQUIRED,
      });
    }

    const windowDays = complex.maintenanceReopenWindowDays ?? 7;
    const reference = ticket.resolvedAt ?? ticket.closedAt ?? ticket.updatedAt;
    const deadline = new Date(
      reference.getTime() + windowDays * 24 * 3_600_000,
    );

    // La administración puede reabrir fuera de plazo: si el ascensor sigue
    // dañado a los quince días, la ventana no es el problema.
    if (!isStaff && new Date() > deadline) {
      throw new CustomError({
        message: `El plazo para reabrir venció el ${this.formatDateTime(deadline)}. Radica un ticket nuevo`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_REOPEN_WINDOW_CLOSED,
      });
    }

    if (!isStaff && ticket.reopenCount >= 1) {
      throw new CustomError({
        message:
          'Este ticket ya se reabrió una vez. Radica uno nuevo describiendo lo que sigue mal',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_REOPEN_LIMIT,
      });
    }

    const from = ticket.status;
    const now = new Date();

    ticket.status =
      ticket.assignedUserId || ticket.vendorId
        ? MaintenanceTicketStatus.ASSIGNED
        : MaintenanceTicketStatus.TRIAGED;
    ticket.resolvedAt = null;
    ticket.closedAt = null;
    ticket.closedByUserId = null;
    ticket.reopenCount += 1;
    ticket.lastReopenedAt = now;

    // Plazo nuevo desde la reapertura: el anterior ya se cumplió —el trabajo
    // se declaró hecho—, y arrastrarlo dejaría el ticket vencido desde el
    // primer segundo.
    const slaHours =
      ticket.slaHours ??
      (await this.slaService.resolveHours(
        ticket.complexId,
        ticket.category,
        ticket.priority,
      ));
    ticket.slaHours = slaHours;
    ticket.slaDueAt = this.slaService.dueAtFrom(now, slaHours);
    ticket.slaBreachedAt = null;

    const saved = await this.ticketRepo.save(ticket);

    await this.addEvent(saved, {
      type: MaintenanceEventType.REOPENED,
      fromStatus: from,
      toStatus: saved.status,
      message: reason.trim(),
      currentUser,
    });

    this.notifyManagers(
      saved,
      NotificationType.MAINTENANCE_TICKET_REOPENED,
      NotificationPriority.HIGH,
      `${saved.code} fue reabierto`,
      reason.trim(),
    ).catch(() => undefined);

    this.emitUpdate(saved);

    return saved;
  }

  /**
   * Cierre administrativo de un ticket resuelto que nadie calificó. Lo usa el
   * cron y también el administrador que quiere sacar la tarjeta del tablero.
   */
  async close(
    ticketId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    const ticket = await this.findByIdOrFail(ticketId);
    await this.complexService.findById(ticket.complexId, currentUser);
    this.assertManager(currentUser);

    if (ticket.status !== MaintenanceTicketStatus.RESOLVED) {
      throw new CustomError({
        message: `Solo se cierra un ticket reparado. Estado actual: ${ticket.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
      });
    }

    ticket.status = MaintenanceTicketStatus.CLOSED;
    ticket.closedAt = new Date();
    ticket.closedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.ticketRepo.save(ticket);

    await this.addEvent(saved, {
      type: MaintenanceEventType.CLOSED,
      fromStatus: MaintenanceTicketStatus.RESOLVED,
      toStatus: saved.status,
      currentUser,
    });

    this.emitUpdate(saved);

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSULTAS
  // ═══════════════════════════════════════════════════════════════════════════

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterMaintenanceTicketsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedMaintenanceTicketsResponse> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.buildBaseQuery(complexId, filters, currentUser);

    this.applyVisibility(qb, currentUser, filters);

    // `orderBy` con el nombre de la PROPIEDAD, no con la columna: con joins y
    // paginación, `t.created_at` revienta la consulta que TypeORM arma para
    // contar los ids.
    qb.orderBy('t.createdAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      items,
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
  ): Promise<MaintenanceTicket> {
    const ticket = await this.ticketRepo.findOne({
      where: { id },
      relations: [
        'building',
        'amenity',
        'locationTag',
        'vendor',
        'assignedUser',
        'reportedByUnit',
        // La torre de la unidad: sin ella el expediente del aviso dice
        // "Unidad 302" y no "Torre 2 · Apto 302", que es como se nombra aquí.
        'reportedByUnit.building',
        'events',
        'events.author',
      ],
      order: { events: { createdAt: 'ASC' } },
    });

    if (!ticket) {
      throw new CustomError({
        message: `Ticket con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(
      ticket.complexId,
      currentUser,
    );

    if (!this.isStaff(currentUser)) {
      await this.assertResidentCanRead(ticket, currentUser);
      return this.maskForResident(ticket);
    }

    return ticket;
  }

  /** El tablero Kanban: una consulta por columna, con tapa. */
  async board(
    complexId: string,
    filters: FilterMaintenanceTicketsInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceBoardResponse> {
    await this.complexService.assertComplexAccess(complexId, currentUser);
    this.assertStaff(currentUser);

    const statuses = filters?.statuses?.length
      ? filters.statuses
      : [
          MaintenanceTicketStatus.NEW,
          MaintenanceTicketStatus.TRIAGED,
          MaintenanceTicketStatus.ASSIGNED,
          MaintenanceTicketStatus.IN_PROGRESS,
          MaintenanceTicketStatus.ON_HOLD,
          MaintenanceTicketStatus.RESOLVED,
        ];

    const columns: MaintenanceBoardColumn[] = [];

    for (const status of statuses) {
      const columnFilters = { ...filters, statuses: undefined };

      // El contador va en su propia consulta, SIN el orden: `getManyAndCount`
      // con un CASE en el ORDER BY revienta con
      // «"CASE t" alias was not found» — TypeORM lee el principio de la
      // expresión como si fuera `alias.propiedad` y sale a buscar un join que
      // no existe. Es la misma trampa del orderBy que ya cobró en otros
      // módulos, con otra cara.
      const total = await this.buildBaseQuery(
        complexId,
        columnFilters,
        currentUser,
      )
        .andWhere('t.status = :status', { status })
        .getCount();

      const qb = this.buildBaseQuery(complexId, columnFilters, currentUser);

      qb.andWhere('t.status = :status', { status })
        // Lo urgente arriba, y a igual urgencia lo más antiguo: quien lleva
        // más esperando no puede quedar debajo de lo que entró hoy.
        .orderBy(
          `CASE t.priority
             WHEN '${MaintenancePriority.CRITICAL}' THEN 0
             WHEN '${MaintenancePriority.HIGH}' THEN 1
             WHEN '${MaintenancePriority.MEDIUM}' THEN 2
             ELSE 3 END`,
          'ASC',
        )
        .addOrderBy('t.createdAt', 'ASC')
        // `limit` y no `take`: `take` pagina con una subconsulta de ids
        // distintos y ahí el CASE tampoco sobrevive. Todos los joins de esta
        // consulta son ManyToOne —un ticket, una fila—, así que limitar filas
        // crudas es exacto.
        .limit(BOARD_COLUMN_LIMIT);

      const tickets = await qb.getMany();

      columns.push({ status, total, tickets });
    }

    const overdueCount = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.complexId = :complexId', { complexId })
      .andWhere('t.status IN (:...statuses)', {
        statuses: OPEN_TICKET_STATUSES,
      })
      .andWhere('t.slaDueAt < :now', { now: new Date() })
      .andWhere('t.deletedAt IS NULL')
      .getCount();

    return { columns, overdueCount };
  }

  /**
   * Puntos para el mapa. Devuelve solo lo que se pinta y marca cuáles son
   * confiables: el pin impreciso existe, pero el mapa tiene que saber que lo es.
   */
  async mapPins(
    complexId: string,
    filters: FilterMaintenanceTicketsInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceMapPinResponse[]> {
    const complex = await this.complexService.findById(complexId, currentUser);
    this.assertStaff(currentUser);

    const threshold = complex.maintenanceGpsAccuracyMeters ?? 100;

    const qb = this.buildBaseQuery(complexId, filters, currentUser)
      .andWhere('t.lat IS NOT NULL')
      .andWhere('t.lng IS NOT NULL');

    if (!filters?.statuses?.length) {
      qb.andWhere('t.status IN (:...openStatuses)', {
        openStatuses: OPEN_TICKET_STATUSES,
      });
    }

    const tickets = await qb.orderBy('t.createdAt', 'DESC').take(500).getMany();
    const now = new Date();

    return tickets.map((ticket) => ({
      id: ticket.id,
      code: ticket.code,
      title: ticket.title,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      locationType: ticket.locationType,
      lat: Number(ticket.lat),
      lng: Number(ticket.lng),
      gpsAccuracyMeters: ticket.gpsAccuracyMeters ?? null,
      isPrecise: isPreciseLocation(
        ticket.locationType,
        ticket.gpsAccuracyMeters,
        threshold,
      ),
      isOverdue:
        !!ticket.slaDueAt &&
        ticket.slaDueAt < now &&
        OPEN_TICKET_STATUSES.includes(ticket.status),
      endorsementCount: ticket.endorsementCount,
      createdAt: ticket.createdAt,
    }));
  }

  /**
   * Mapa de calor por SITIO. Agrupa por tag, zona común o torre —lo que el
   * ticket tenga—, porque esa es la pregunta que se responde: qué se está
   * dañando siempre en el mismo lugar.
   */
  async heatmap(
    complexId: string,
    days: number,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceHeatmapCell[]> {
    await this.complexService.assertComplexAccess(complexId, currentUser);
    this.assertStaff(currentUser);

    const since = new Date(Date.now() - days * 24 * 3_600_000);

    const tickets = await this.ticketRepo.find({
      where: {
        complexId,
        createdAt: MoreThanOrEqual(since),
        deletedAt: IsNull(),
      },
      relations: ['locationTag', 'amenity', 'building'],
      order: { createdAt: 'DESC' },
      take: 5000,
    });

    const now = new Date();
    const cells = new Map<
      string,
      MaintenanceHeatmapCell & { categories: Map<MaintenanceCategory, number> }
    >();

    for (const ticket of tickets) {
      const { key, label, lat, lng } = this.heatmapKeyOf(ticket);

      const cell = cells.get(key) ?? {
        key,
        label,
        total: 0,
        openCount: 0,
        overdueCount: 0,
        topCategory: null,
        lat,
        lng,
        categories: new Map<MaintenanceCategory, number>(),
      };

      cell.total += 1;
      if (OPEN_TICKET_STATUSES.includes(ticket.status)) {
        cell.openCount += 1;
        if (ticket.slaDueAt && ticket.slaDueAt < now) cell.overdueCount += 1;
      }
      cell.categories.set(
        ticket.category,
        (cell.categories.get(ticket.category) ?? 0) + 1,
      );
      cell.lat = cell.lat ?? lat;
      cell.lng = cell.lng ?? lng;

      cells.set(key, cell);
    }

    return [...cells.values()]
      .map(({ categories, ...cell }) => ({
        ...cell,
        topCategory:
          [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      }))
      .sort((a, b) => b.total - a.total);
  }

  /** El resumen que el administrador lleva al consejo. */
  async stats(
    complexId: string,
    days: number,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceStatsResponse> {
    await this.complexService.assertComplexAccess(complexId, currentUser);
    this.assertStaff(currentUser);

    const since = new Date(Date.now() - days * 24 * 3_600_000);
    const now = new Date();

    const tickets = await this.ticketRepo.find({
      where: { complexId, deletedAt: IsNull() },
      take: 10000,
    });

    const scoped = tickets.filter((ticket) => ticket.createdAt >= since);

    const byStatus = new Map<MaintenanceTicketStatus, number>();
    const byCategory = new Map<MaintenanceCategory, number>();

    let openTickets = 0;
    let overdueTickets = 0;
    let resolutionHoursSum = 0;
    let resolvedCount = 0;
    let onTimeCount = 0;
    let ratingSum = 0;
    let ratedTickets = 0;
    let totalCost = 0;

    for (const ticket of scoped) {
      byStatus.set(ticket.status, (byStatus.get(ticket.status) ?? 0) + 1);
      byCategory.set(
        ticket.category,
        (byCategory.get(ticket.category) ?? 0) + 1,
      );

      if (OPEN_TICKET_STATUSES.includes(ticket.status)) {
        openTickets += 1;
        if (ticket.slaDueAt && ticket.slaDueAt < now) overdueTickets += 1;
      }

      if (ticket.resolvedAt) {
        resolvedCount += 1;
        resolutionHoursSum +=
          (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) /
          3_600_000;
        if (!ticket.slaDueAt || ticket.resolvedAt <= ticket.slaDueAt) {
          onTimeCount += 1;
        }
      }

      if (ticket.rating != null) {
        ratedTickets += 1;
        ratingSum += ticket.rating;
      }

      if (ticket.actualCost) totalCost += Number(ticket.actualCost);
    }

    return {
      totalTickets: scoped.length,
      openTickets,
      overdueTickets,
      byStatus: [...byStatus.entries()].map(([status, count]) => ({
        status,
        count,
      })),
      byCategory: [...byCategory.entries()].map(([category, count]) => ({
        category,
        count,
      })),
      averageResolutionHours: resolvedCount
        ? Number((resolutionHoursSum / resolvedCount).toFixed(1))
        : null,
      slaComplianceRate: resolvedCount
        ? Number(((onTimeCount / resolvedCount) * 100).toFixed(1))
        : null,
      averageRating: ratedTickets
        ? Number((ratingSum / ratedTickets).toFixed(2))
        : null,
      ratedTickets,
      totalCost: totalCost || null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAREAS PROGRAMADAS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Marca los tickets que pasaron su plazo y avisa una sola vez.
   *
   * El sello `slaBreachedAt` es lo que evita que el administrador reciba el
   * mismo aviso cada hora hasta que alguien arregle la lámpara — al tercero ya
   * nadie los lee.
   */
  async breachOverdueTickets(): Promise<number> {
    const now = new Date();

    const overdue = await this.ticketRepo.find({
      where: {
        status: In(OPEN_TICKET_STATUSES),
        slaDueAt: LessThan(now),
        slaBreachedAt: IsNull(),
        deletedAt: IsNull(),
      },
      // Con relaciones: el aviso de incumplimiento tiene que decir DÓNDE, que
      // es lo que decide si alguien sale a mirarlo ahora o mañana.
      relations: ['building', 'amenity', 'locationTag'],
      take: 500,
    });

    for (const ticket of overdue) {
      ticket.slaBreachedAt = now;
      await this.ticketRepo.save(ticket);

      await this.addEvent(ticket, {
        type: MaintenanceEventType.SLA_BREACHED,
        message: `El plazo venció el ${this.formatDateTime(ticket.slaDueAt)}`,
      });

      const roles = [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL];

      // El consejo se entera solo de lo crítico. Enviarle todo lo vencido lo
      // convierte en un buzón que nadie abre.
      if (ticket.priority === MaintenancePriority.CRITICAL) {
        roles.push(ValidRoles.COUNCIL_ROL);
      }

      await this.notifyRoles(
        ticket,
        roles,
        NotificationType.MAINTENANCE_SLA_BREACHED,
        NotificationPriority.HIGH,
        `${ticket.code} venció su plazo`,
        `${ticket.title} — ${this.describeLocation(ticket)}`,
      ).catch(() => undefined);

      this.emitUpdate(ticket);
    }

    return overdue.length;
  }

  /**
   * Cierra los reparados que nadie confirmó.
   *
   * Sin esto el tablero se llena de tickets que ya nadie va a tocar: el
   * residente vio que la lámpara sirve y no vuelve a abrir la app.
   */
  async autoCloseResolvedTickets(): Promise<number> {
    // El plazo lo pone cada complejo, así que se compara contra su propia
    // columna dentro de la consulta: traer todos los complejos para recorrerlos
    // en JavaScript sería una consulta por copropiedad para cerrar dos tickets.
    const pending = await this.ticketRepo
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.complex', 'c')
      .where('t.status = :status', { status: MaintenanceTicketStatus.RESOLVED })
      .andWhere('t.resolved_at IS NOT NULL')
      .andWhere(
        `t.resolved_at < now() - (COALESCE(c.maintenance_auto_close_days, 7) * interval '1 day')`,
      )
      .andWhere('t.deletedAt IS NULL')
      .take(500)
      .getMany();

    for (const ticket of pending) {
      const days = ticket.complex?.maintenanceAutoCloseDays ?? 7;

      ticket.status = MaintenanceTicketStatus.CLOSED;
      ticket.closedAt = new Date();
      await this.ticketRepo.save(ticket);

      await this.addEvent(ticket, {
        type: MaintenanceEventType.CLOSED,
        fromStatus: MaintenanceTicketStatus.RESOLVED,
        toStatus: MaintenanceTicketStatus.CLOSED,
        message: `Cerrado automáticamente tras ${days} días sin confirmación`,
      });

      this.emitUpdate(ticket);
    }

    return pending.length;
  }

  /** Recuerda calificar a quien reportó, una vez, dos días después. */
  async remindPendingRatings(): Promise<number> {
    const from = new Date(Date.now() - 3 * 24 * 3_600_000);
    const to = new Date(Date.now() - 2 * 24 * 3_600_000);

    const pending = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.status = :status', { status: MaintenanceTicketStatus.RESOLVED })
      .andWhere('t.rating IS NULL')
      .andWhere('t.resolvedAt BETWEEN :from AND :to', { from, to })
      .andWhere('t.reportedByUserId IS NOT NULL')
      .andWhere('t.deletedAt IS NULL')
      .take(300)
      .getMany();

    for (const ticket of pending) {
      await this.notifyReporter(
        ticket,
        NotificationType.MAINTENANCE_RATING_REQUESTED,
        NotificationPriority.LOW,
        `¿Cómo quedó ${ticket.code}?`,
        `${ticket.title} — cuéntanos si el arreglo quedó bien.`,
      ).catch(() => undefined);
    }

    return pending.length;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private buildBaseQuery(
    complexId: string,
    filters: FilterMaintenanceTicketsInput,
    currentUser: JwtAccessPayload,
  ) {
    const qb = this.ticketRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.building', 'building')
      .leftJoinAndSelect('t.amenity', 'amenity')
      .leftJoinAndSelect('t.locationTag', 'locationTag')
      .leftJoinAndSelect('t.vendor', 'vendor')
      .leftJoinAndSelect('t.assignedUser', 'assignedUser')
      .where('t.complexId = :complexId', { complexId })
      .andWhere('t.deletedAt IS NULL');

    if (filters?.statuses?.length) {
      qb.andWhere('t.status IN (:...statuses)', { statuses: filters.statuses });
    }
    if (filters?.category) {
      qb.andWhere('t.category = :category', { category: filters.category });
    }
    if (filters?.priority) {
      qb.andWhere('t.priority = :priority', { priority: filters.priority });
    }
    if (filters?.buildingId) {
      qb.andWhere('t.buildingId = :buildingId', {
        buildingId: filters.buildingId,
      });
    }
    if (filters?.amenityId) {
      qb.andWhere('t.amenityId = :amenityId', { amenityId: filters.amenityId });
    }
    if (filters?.locationTagId) {
      qb.andWhere('t.locationTagId = :locationTagId', {
        locationTagId: filters.locationTagId,
      });
    }
    if (filters?.assigneeType) {
      qb.andWhere('t.assigneeType = :assigneeType', {
        assigneeType: filters.assigneeType,
      });
    }
    if (filters?.assignedUserId) {
      qb.andWhere('t.assignedUserId = :assignedUserId', {
        assignedUserId: filters.assignedUserId,
      });
    }
    if (filters?.vendorId) {
      qb.andWhere('t.vendorId = :vendorId', { vendorId: filters.vendorId });
    }
    if (filters?.rating != null) {
      qb.andWhere('t.rating = :rating', { rating: filters.rating });
    }
    if (filters?.onlyOverdue) {
      qb.andWhere('t.slaDueAt < :now', { now: new Date() }).andWhere(
        't.status IN (:...openStatuses)',
        { openStatuses: OPEN_TICKET_STATUSES },
      );
    }
    if (filters?.onlyUnassigned) {
      qb.andWhere('t.assignedUserId IS NULL').andWhere('t.vendorId IS NULL');
    }
    if (filters?.onlyMine) {
      qb.andWhere('t.reportedByUserId = :me', { me: currentUser.sub });
    }
    if (filters?.dateFrom) {
      qb.andWhere('t.createdAt >= :dateFrom', {
        dateFrom: new Date(filters.dateFrom),
      });
    }
    if (filters?.dateTo) {
      qb.andWhere('t.createdAt <= :dateTo', {
        dateTo: new Date(filters.dateTo),
      });
    }
    if (filters?.search) {
      qb.andWhere(
        '(t.code ILIKE :search OR t.title ILIKE :search OR t.description ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    return qb;
  }

  /**
   * Al residente le llega lo público del complejo y lo suyo.
   *
   * Ver los tickets públicos de los vecinos no es un descuido: es lo que evita
   * el reporte número treinta del mismo ascensor. Lo que no ve es lo marcado
   * como privado —una cámara dañada es un mapa para quien quiera entrar— ni
   * las notas internas.
   */
  private applyVisibility(
    qb: ReturnType<typeof this.buildBaseQuery>,
    currentUser: JwtAccessPayload,
    filters: FilterMaintenanceTicketsInput,
  ): void {
    if (this.isStaff(currentUser)) return;

    if (filters?.onlyMine) return;

    qb.andWhere('(t.visibility = :public OR t.reportedByUserId = :me)', {
      public: MaintenanceVisibility.PUBLIC,
      me: currentUser.sub,
    });
  }

  private async assertResidentCanRead(
    ticket: MaintenanceTicket,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    if (ticket.reportedByUserId === currentUser.sub) return;
    if (ticket.visibility === MaintenanceVisibility.PUBLIC) return;

    const endorsed = await this.endorsementRepo.findOne({
      where: { ticketId: ticket.id, userId: currentUser.sub },
    });
    if (endorsed) return;

    throw new CustomError({
      message: 'No tienes acceso a este ticket',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_ACCESS_DENIED,
    });
  }

  /** Le quita al residente las notas internas de la bitácora. */
  private maskForResident(ticket: MaintenanceTicket): MaintenanceTicket {
    if (ticket.events?.length) {
      ticket.events = ticket.events.filter((event) => !event.isInternal);
    }
    return ticket;
  }

  private isStaff(user: JwtAccessPayload): boolean {
    return user.roles?.some((role) => STAFF_ROLES.includes(role)) ?? false;
  }

  private assertStaff(user: JwtAccessPayload): void {
    if (!this.isStaff(user)) {
      throw new CustomError({
        message: 'No tienes permisos para ver el tablero de mantenimiento',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }

  private assertManager(user: JwtAccessPayload): void {
    const canManage =
      user.roles?.some((role) => MANAGER_ROLES.includes(role)) ?? false;

    if (!canManage) {
      throw new CustomError({
        message: 'No tienes permisos para gestionar tickets de mantenimiento',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }

  /**
   * El todero asignado mueve SU ticket sin ser administrador. Sin esto, cada
   * avance del personal interno tendría que pasar por la oficina, que es
   * exactamente el cuello de botella que el módulo viene a quitar.
   */
  private assertStaffOrAssignee(
    ticket: MaintenanceTicket,
    user: JwtAccessPayload,
  ): void {
    if (this.isStaff(user)) return;
    if (ticket.assignedUserId && ticket.assignedUserId === user.sub) return;

    throw new CustomError({
      message: 'No tienes permisos para modificar este ticket',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: GeneralErrorCode.FORBIDDEN,
    });
  }

  async findByIdOrFail(id: string): Promise<MaintenanceTicket> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });

    if (!ticket) {
      throw new CustomError({
        message: `Ticket con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_NOT_FOUND,
      });
    }

    return ticket;
  }

  /**
   * Recarga el ticket con lo que hace falta para CONTARLO: torre, zona común y
   * punto señalizado.
   *
   * La entidad que devuelve `save()` trae los ids pero no las relaciones, y un
   * aviso armado con ella decía "Zona común" aunque el residente hubiera
   * señalado la torre y el piso. Si la recarga falla, se sigue con lo que hay:
   * un aviso con menos detalle es mejor que un reporte sin avisar.
   */
  private async loadRelations(
    ticket: MaintenanceTicket,
  ): Promise<MaintenanceTicket> {
    try {
      const full = await this.ticketRepo.findOne({
        where: { id: ticket.id },
        relations: [
          'building',
          'amenity',
          'locationTag',
          'vendor',
          'assignedUser',
          'reportedByUnit',
          'reportedByUnit.building',
        ],
      });

      return full ?? ticket;
    } catch {
      return ticket;
    }
  }

  /**
   * Lo que viaja en el aviso además del texto.
   *
   * Es el respaldo de la pantalla: cuando el expediente en vivo no se puede
   * armar —la entidad cambió, o quien abre no alcanza a verla—, esto es lo
   * único que le queda al administrador. Por eso lleva la ubicación desglosada
   * y no solo el id del ticket.
   */
  private notificationMetadata(
    ticket: MaintenanceTicket,
  ): Record<string, unknown> {
    const floorLabel =
      ticket.floor == null
        ? null
        : ticket.floor < 0
          ? `Sótano ${Math.abs(ticket.floor)}`
          : `Piso ${ticket.floor}`;

    const metadata: Record<string, unknown> = {
      ticketId: ticket.id,
      code: ticket.code,
      status: ticket.status,
      category: ticket.category,
      priority: ticket.priority,
      site: this.describeLocation(ticket),
      buildingName: ticket.building?.name ?? null,
      floorLabel,
      amenityName: ticket.amenity?.name ?? null,
      tagName: ticket.locationTag?.name ?? null,
      locationReference: ticket.locationText ?? null,
      reportedBy: ticket.reportedByName ?? null,
      unitNumber: ticket.reportedByUnit?.number ?? null,
      dueDate: ticket.slaDueAt ?? null,
    };

    if (ticket.lat != null && ticket.lng != null) {
      metadata.requestLat = ticket.lat;
      metadata.requestLng = ticket.lng;
    }

    // Las claves vacías se quitan: el respaldo pinta TODO lo que reciba, y una
    // ficha con seis renglones en blanco se lee peor que una corta.
    const clean: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (value !== null && value !== undefined && value !== '') {
        clean[key] = value;
      }
    }

    return clean;
  }

  private async addEvent(
    ticket: MaintenanceTicket,
    params: {
      type: MaintenanceEventType;
      message?: string | null;
      fromStatus?: MaintenanceTicketStatus | null;
      toStatus?: MaintenanceTicketStatus | null;
      imageUrls?: string[];
      imageHashes?: string[];
      isInternal?: boolean;
      currentUser?: JwtAccessPayload;
    },
  ): Promise<MaintenanceTicketEvent> {
    return this.eventRepo.save(
      this.eventRepo.create({
        ticketId: ticket.id,
        complexId: ticket.complexId,
        type: params.type,
        message: params.message ?? null,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
        imageUrls: params.imageUrls ?? [],
        imageHashes: params.imageHashes ?? [],
        isInternal: params.isInternal ?? false,
        authorUserId:
          params.currentUser?.entityType === 'user'
            ? params.currentUser.sub
            : null,
        authorRole: params.currentUser?.roles?.[0] ?? null,
        authorName: params.currentUser?.email ?? null,
      }),
    );
  }

  /**
   * Avisa a quien reportó y a los vecinos que se sumaron.
   *
   * Los adheridos entran porque su daño es el mismo: si no se les avisa, la
   * adhesión les cuesta información —cuando radicaban su propio ticket al menos
   * les llegaba el estado—.
   */
  private async notifyReporter(
    ticket: MaintenanceTicket,
    type: NotificationType,
    priority: NotificationPriority,
    title: string,
    body: string,
  ): Promise<void> {
    const endorsements = await this.endorsementRepo.find({
      where: { ticketId: ticket.id },
      select: ['userId'],
    });

    const userIds = [
      ...new Set(
        [
          ticket.reportedByUserId,
          ...endorsements.map((item) => item.userId),
        ].filter((id): id is string => !!id),
      ),
    ];

    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: ticket.complexId,
      userIds,
      type,
      priority,
      title,
      body,
      entityId: ticket.id,
      entityType: 'maintenance_ticket',
      metadata: this.notificationMetadata(ticket),
    });
  }

  private notifyManagers(
    ticket: MaintenanceTicket,
    type: NotificationType,
    priority: NotificationPriority,
    title: string,
    body: string,
  ): Promise<void> {
    return this.notifyRoles(
      ticket,
      [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
      type,
      priority,
      title,
      body,
    );
  }

  private async notifyRoles(
    ticket: MaintenanceTicket,
    roles: ValidRoles[],
    type: NotificationType,
    priority: NotificationPriority,
    title: string,
    body: string,
  ): Promise<void> {
    const userIds = await this.notificationsService.findUserIdsByRoles(
      ticket.complexId,
      roles,
    );
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: ticket.complexId,
      userIds,
      type,
      priority,
      title,
      body,
      entityId: ticket.id,
      entityType: 'maintenance_ticket',
      isActionable: true,
      metadata: this.notificationMetadata(ticket),
    });
  }

  private emitUpdate(ticket: MaintenanceTicket): void {
    const payload = {
      ticketId: ticket.id,
      code: ticket.code,
      status: ticket.status,
    };

    this.socketService.emitToComplex(
      ticket.complexId,
      SocketEvent.MAINTENANCE_TICKET_UPDATED,
      payload,
    );

    // El residente no está en la sala del complejo —ahí escuchan la
    // administración y la portería—, así que sin este segundo envío quien
    // reportó no ve moverse nada en caliente.
    if (ticket.reportedByUnitId) {
      this.socketService.emitToUnit(
        ticket.reportedByUnitId,
        SocketEvent.MAINTENANCE_TICKET_UPDATED,
        payload,
      );
    }
  }

  private heatmapKeyOf(ticket: MaintenanceTicket): {
    key: string;
    label: string;
    lat: number | null;
    lng: number | null;
  } {
    if (ticket.locationTagId) {
      return {
        key: `tag:${ticket.locationTagId}`,
        label: ticket.locationTag?.name ?? 'Punto señalizado',
        lat: ticket.locationTag?.lat ?? ticket.lat ?? null,
        lng: ticket.locationTag?.lng ?? ticket.lng ?? null,
      };
    }

    if (ticket.amenityId) {
      return {
        key: `amenity:${ticket.amenityId}`,
        label: ticket.amenity?.name ?? 'Zona común',
        lat: ticket.lat ?? null,
        lng: ticket.lng ?? null,
      };
    }

    if (ticket.buildingId) {
      const floor = ticket.floor != null ? ` · piso ${ticket.floor}` : '';
      return {
        key: `building:${ticket.buildingId}:${ticket.floor ?? 'x'}`,
        label: `${ticket.building?.name ?? 'Torre'}${floor}`,
        lat: ticket.lat ?? null,
        lng: ticket.lng ?? null,
      };
    }

    return {
      key: 'unlocated',
      label: 'Sin ubicación precisa',
      lat: ticket.lat ?? null,
      lng: ticket.lng ?? null,
    };
  }

  /**
   * El sitio en una línea, con TODO lo que se sepa.
   *
   * Antes devolvía el primer dato que encontrara, así que una referencia
   * escrita tapaba la torre: el aviso decía "junto al parqueadero 45" y el
   * administrador no sabía de cuál de las cinco torres. Quien recibe el aviso
   * tiene que poder salir a buscar el daño sin abrir el tablero.
   */
  private describeLocation(ticket: MaintenanceTicket): string {
    const parts = [
      ticket.locationTag?.name,
      ticket.amenity?.name,
      ticket.building?.name,
      ticket.floor == null
        ? null
        : ticket.floor < 0
          ? `Sótano ${Math.abs(ticket.floor)}`
          : `Piso ${ticket.floor}`,
      ticket.locationText,
    ].filter((part): part is string => !!part);

    return parts.length ? parts.join(' · ') : 'Zona común';
  }

  private describeStatus(status: MaintenanceTicketStatus): string {
    const labels: Record<MaintenanceTicketStatus, string> = {
      [MaintenanceTicketStatus.NEW]: 'reporte recibido',
      [MaintenanceTicketStatus.TRIAGED]: 'en revisión',
      [MaintenanceTicketStatus.ASSIGNED]: 'técnico asignado',
      [MaintenanceTicketStatus.IN_PROGRESS]: 'en reparación',
      [MaintenanceTicketStatus.ON_HOLD]: 'reparación detenida',
      [MaintenanceTicketStatus.RESOLVED]: 'reparado',
      [MaintenanceTicketStatus.CLOSED]: 'cerrado',
      [MaintenanceTicketStatus.REJECTED]: 'no procede',
      [MaintenanceTicketStatus.DUPLICATE]: 'ya estaba reportado',
    };

    return labels[status] ?? status;
  }

  private formatDateTime(date: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    }).format(new Date(date));
  }
}
