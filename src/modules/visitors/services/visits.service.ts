import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Visit }                  from '../entities/visit.entity';
import { VisitStatus }            from '../enums/visit-status.enum';
import { VisitType }              from '../enums/visit-type.enum';
import { RegisterWalkInInput }    from '../dto/inputs/register-walk-in.input';
import { ScheduleVisitInput }     from '../dto/inputs/schedule-visit.input';
import { FilterVisitsInput }      from '../dto/inputs/filter-visits.input';
import { PaginatedVisitsResponse } from '../dto/responses/paginated-visits.response';
import { QrValidationResponse }   from '../dto/responses/qr-validation.response';

import { PaginationInput }         from '../../shared/dto/inputs/pagination.input';
import { CustomError }             from '../../shared/utils/errors.utils';
import { AccessErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }        from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { VisitorsService }         from './visitors.service';
import { ResidentsService }        from '../../residents/services/residents.service';
import { ResidentStatus }          from '../../residents/enums/resident-status.enum';
import { AuditService }            from '../../audit/services/audit.service';
import { AuditAction }             from '../../audit/enums/audit-action.enum';
import { AuditEntityType }         from '../../audit/enums/audit-entity-type.enum';

// Duración por defecto del QR: 48 horas
const QR_DEFAULT_TTL_HOURS = 48;

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    @InjectRepository(Visit)
    private readonly visitRepo: Repository<Visit>,
    private readonly visitorsService: VisitorsService,
    private readonly complexService:  ResidentialComplexService,
    private readonly residentsService: ResidentsService,
    private readonly auditService:    AuditService,
  ) {}

  // ================================================================
  // REGISTRAR WALK-IN (guardia de seguridad)
  // Crea el visitante si no existe y genera la visita en PENDING_APPROVAL
  // ================================================================

  async registerWalkIn(
    input: RegisterWalkInInput,
    currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    // 1. Verificar que el complejo existe
    await this.complexService.findById(input.complexId, currentUser);

    // 2. Obtener o crear visitante
    const visitor = await this.visitorsService.findOrCreate(input.complexId, {
      name:      input.visitorName,
      lastName:  input.visitorLastName,
      identity:  input.visitorIdentity,
      phone:     input.visitorPhone,
      photoUrl:  input.visitorPhotoUrl,
    });

    // 3. Verificar lista negra ANTES de crear la visita
    await this.visitorsService.assertNotBlacklisted(visitor);

    // 4. Verificar que el residente anfitrión existe y está ACTIVO
    const resident = await this.residentsService.findById(input.hostResidentId, currentUser);
    if (resident.status !== ResidentStatus.ACTIVE) {
      throw new CustomError({
        message: 'El residente anfitrión no está activo en el complejo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // 5. Crear visita en PENDING_APPROVAL
    const visit = this.visitRepo.create({
      visitorId:          visitor.id,
      hostResidentId:     input.hostResidentId,
      unitId:             input.unitId,
      complexId:          input.complexId,
      type:               input.type ?? VisitType.WALK_IN,
      status:             VisitStatus.PENDING_APPROVAL,
      purpose:            input.purpose,
      vehiclePlate:       input.vehiclePlate?.toUpperCase().trim(),
      notes:              input.notes,
      registeredByUserId: currentUser.sub,
    });

    const saved = await this.visitRepo.save(visit);
    this.logger.log(
      `Walk-in registrado: ${saved.id} — visitante: ${visitor.fullName} → unidad ${input.unitId}`,
    );

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        saved.id,
      action:          AuditAction.CREATE,
      newValue:        { id: saved.id, visitorId: visitor.id, unitId: input.unitId, status: saved.status },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       input.complexId,
      description:     `Walk-in registrado: ${visitor.fullName} → unidad ${input.unitId}`,
    });

    // TODO: Fase de notificaciones — notificar al residente en tiempo real via WebSocket
    return this.loadRelations(saved.id);
  }

  // ================================================================
  // AGENDAR VISITA (residente pre-autoriza con QR)
  // ================================================================

  async scheduleVisit(
    input: ScheduleVisitInput,
    currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    // 1. Verificar complejo
    await this.complexService.findById(input.complexId, currentUser);

    // 2. Verificar que el residente existe y está activo
    const resident = await this.residentsService.findById(input.hostResidentId, currentUser);
    if (resident.status !== ResidentStatus.ACTIVE) {
      throw new CustomError({
        message: 'Solo residentes activos pueden agendar visitas',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // 3. Obtener o crear visitante
    const visitor = await this.visitorsService.findOrCreate(input.complexId, {
      name:     input.visitorName,
      lastName: input.visitorLastName,
      identity: input.visitorIdentity,
      phone:    input.visitorPhone,
    });

    // 4. Verificar lista negra
    await this.visitorsService.assertNotBlacklisted(visitor);

    // 5. Calcular expiración del QR
    const expectedAt = new Date(input.expectedArrivalAt);
    const qrExpiresAt = input.expectedArrivalUntil
      ? new Date(input.expectedArrivalUntil)
      : new Date(expectedAt.getTime() + QR_DEFAULT_TTL_HOURS * 60 * 60 * 1000);

    // 6. Crear visita pre-aprobada con QR
    const visit = this.visitRepo.create({
      visitorId:             visitor.id,
      hostResidentId:        input.hostResidentId,
      unitId:                input.unitId,
      complexId:             input.complexId,
      type:                  VisitType.SCHEDULED,
      status:                VisitStatus.APPROVED,
      purpose:               input.purpose,
      vehiclePlate:          input.vehiclePlate?.toUpperCase().trim(),
      notes:                 input.notes,
      expectedArrivalAt:     expectedAt,
      expectedArrivalUntil:  qrExpiresAt,
      qrToken:               uuidv4(), // Token único para el QR
      qrUsed:                false,
      qrExpiresAt,
      approvedByResidentAt:  new Date(),
      registeredByUserId:    currentUser.sub,
    });

    const saved = await this.visitRepo.save(visit);
    this.logger.log(`Visita agendada: ${saved.id} con QR ${saved.qrToken}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        saved.id,
      action:          AuditAction.CREATE,
      newValue:        { id: saved.id, visitorId: visitor.id, unitId: input.unitId, type: 'SCHEDULED', status: saved.status },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       input.complexId,
      description:     `Visita agendada con QR: ${visitor.fullName} → unidad ${input.unitId}`,
    });

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // APROBAR VISITA (residente aprueba un walk-in)
  // ================================================================

  async approveVisitEntry(
    visitId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    const visit = await this.findById(visitId, currentUser);

    if (visit.status !== VisitStatus.PENDING_APPROVAL) {
      throw new CustomError({
        message: `La visita no está en estado PENDING_APPROVAL. Estado actual: ${visit.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    visit.status               = VisitStatus.APPROVED;
    visit.approvedByResidentAt = new Date();

    const saved = await this.visitRepo.save(visit);
    this.logger.log(`Visita aprobada por residente: ${visitId}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        visitId,
      action:          AuditAction.APPROVE,
      previousValue:   { status: VisitStatus.PENDING_APPROVAL },
      newValue:        { status: VisitStatus.APPROVED, approvedByResidentAt: saved.approvedByResidentAt },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       visit.complexId,
      description:     `Visita aprobada por residente`,
    });

    // TODO: Notificar al guardia en tiempo real
    return this.loadRelations(saved.id);
  }

  // ================================================================
  // DENEGAR VISITA (residente rechaza un walk-in)
  // ================================================================

  async denyVisitEntry(
    visitId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    const visit = await this.findById(visitId, currentUser);

    if (visit.status !== VisitStatus.PENDING_APPROVAL) {
      throw new CustomError({
        message: `Solo se pueden denegar visitas en PENDING_APPROVAL. Estado: ${visit.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    visit.status              = VisitStatus.DENIED;
    visit.deniedByResidentAt  = new Date();
    visit.denialReason        = reason;

    this.logger.warn(`Visita denegada por residente: ${visitId} — razón: ${reason}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        visitId,
      action:          AuditAction.REJECT,
      previousValue:   { status: VisitStatus.PENDING_APPROVAL },
      newValue:        { status: VisitStatus.DENIED, denialReason: reason },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       visit.complexId,
      description:     `Visita denegada — razón: ${reason}`,
    });

    // TODO: Notificar al guardia en tiempo real
    return this.visitRepo.save(visit);
  }

  // ================================================================
  // REGISTRAR ENTRADA (guardia confirma ingreso físico)
  // ================================================================

  async registerEntry(
    visitId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    const visit = await this.findById(visitId, currentUser);

    if (visit.status !== VisitStatus.APPROVED) {
      throw new CustomError({
        message: `Solo se puede registrar entrada de visitas APPROVED. Estado: ${visit.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AccessErrorCode.VISIT_NOT_AUTHORIZED,
      });
    }

    visit.status    = VisitStatus.INSIDE;
    visit.entryTime = new Date();

    this.logger.log(`Entrada registrada: ${visitId} a las ${visit.entryTime.toISOString()}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        visitId,
      action:          AuditAction.UPDATE,
      previousValue:   { status: VisitStatus.APPROVED },
      newValue:        { status: VisitStatus.INSIDE, entryTime: visit.entryTime },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       visit.complexId,
      description:     `Entrada de visitante registrada en unidad ${visit.unitId}`,
    });

    return this.visitRepo.save(visit);
  }

  // ================================================================
  // VALIDAR Y USAR QR (guardia escanea QR — permite entrada directa)
  // ================================================================

  async validateAndUseQr(
    qrToken: string,
    currentUser: JwtAccessPayload,
  ): Promise<QrValidationResponse> {
    const visit = await this.visitRepo.findOne({
      where:     { qrToken },
      relations: ['visitor', 'unit', 'unit.building', 'hostResident', 'hostResident.user'],
    });

    // QR no existe
    if (!visit) {
      return { isValid: false, message: 'QR inválido o no encontrado' };
    }

    // QR ya fue usado
    if (visit.qrUsed) {
      return { isValid: false, message: 'Este QR ya fue utilizado', visit, visitor: visit.visitor };
    }

    // QR expirado
    if (visit.qrExpiresAt && new Date() > visit.qrExpiresAt) {
      visit.status = VisitStatus.EXPIRED;
      await this.visitRepo.save(visit);
      return { isValid: false, message: 'El QR de acceso ha expirado', visit, visitor: visit.visitor };
    }

    // Visita en estado inválido para ingreso
    if (visit.status !== VisitStatus.APPROVED) {
      return {
        isValid: false,
        message:  `La visita no está en estado APPROVED. Estado: ${visit.status}`,
        visit,
        visitor: visit.visitor,
      };
    }

    // Verificar lista negra (podría haberse bloqueado después de generar el QR)
    if (visit.visitor?.isBlacklisted) {
      return {
        isValid: false,
        message:  `Visitante en lista negra: ${visit.visitor.blacklistReason}`,
        visitor:  visit.visitor,
      };
    }

    // ✅ QR válido — registrar entrada
    visit.status    = VisitStatus.INSIDE;
    visit.entryTime = new Date();
    visit.qrUsed    = true;

    await this.visitRepo.save(visit);
    this.logger.log(`QR validado y entrada registrada: visita ${visit.id}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        visit.id,
      action:          AuditAction.APPROVE,
      newValue:        { status: VisitStatus.INSIDE, entryTime: visit.entryTime, qrUsed: true },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       visit.complexId,
      description:     `Acceso por QR: ${visit.visitor?.fullName} → unidad ${visit.unitId}`,
    });

    return {
      isValid:  true,
      message:  `Acceso autorizado. Bienvenido ${visit.visitor?.fullName}`,
      visit,
      visitor:  visit.visitor,
    };
  }

  // ================================================================
  // REGISTRAR SALIDA
  // ================================================================

  async registerExit(
    visitId: string,
    currentUser: JwtAccessPayload,
    notes?: string,
  ): Promise<Visit> {
    const visit = await this.findById(visitId, currentUser);

    if (visit.status !== VisitStatus.INSIDE) {
      throw new CustomError({
        message: `Solo se puede registrar salida de visitas con estado INSIDE. Estado: ${visit.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    visit.status                  = VisitStatus.COMPLETED;
    visit.exitTime                = new Date();
    visit.exitRegisteredByUserId  = currentUser.sub;
    if (notes) visit.notes        = notes;

    this.logger.log(`Salida registrada: ${visitId} a las ${visit.exitTime.toISOString()}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        visitId,
      action:          AuditAction.UPDATE,
      previousValue:   { status: VisitStatus.INSIDE },
      newValue:        { status: VisitStatus.COMPLETED, exitTime: visit.exitTime },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       visit.complexId,
      description:     `Salida de visitante registrada desde unidad ${visit.unitId}`,
    });

    return this.visitRepo.save(visit);
  }

  // ================================================================
  // CANCELAR VISITA (residente o admin)
  // ================================================================

  async cancelVisit(
    visitId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    const visit = await this.findById(visitId, currentUser);

    const cancellableStates = [VisitStatus.PENDING_APPROVAL, VisitStatus.APPROVED];
    if (!cancellableStates.includes(visit.status)) {
      throw new CustomError({
        message: `No se puede cancelar una visita en estado ${visit.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const prevStatus = visit.status;
    visit.status = VisitStatus.CANCELLED;
    this.logger.log(`Visita cancelada: ${visitId} por ${currentUser.sub}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Visit,
      entityId:        visitId,
      action:          AuditAction.DELETE,
      previousValue:   { status: prevStatus },
      newValue:        { status: VisitStatus.CANCELLED },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       visit.complexId,
      description:     `Visita cancelada`,
    });

    return this.visitRepo.save(visit);
  }

  // ================================================================
  // LISTAR VISITAS DEL COMPLEJO
  // ================================================================

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterVisitsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedVisitsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.visitRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.visitor', 'visitor')
      .leftJoinAndSelect('v.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .leftJoinAndSelect('v.hostResident', 'resident')
      .leftJoinAndSelect('resident.user', 'residentUser')
      .leftJoinAndSelect('v.registeredByUser', 'guard')
      .where('v.complex_id = :complexId', { complexId });

    if (filters?.status)         qb.andWhere('v.status = :status',           { status: filters.status });
    if (filters?.type)           qb.andWhere('v.type = :type',               { type: filters.type });
    if (filters?.unitId)         qb.andWhere('v.unit_id = :unitId',          { unitId: filters.unitId });
    if (filters?.hostResidentId) qb.andWhere('v.host_resident_id = :rid',    { rid: filters.hostResidentId });
    if (filters?.dateFrom)       qb.andWhere('v.created_at >= :from',        { from: filters.dateFrom });
    if (filters?.dateTo)         qb.andWhere('v.created_at <= :to',          { to: filters.dateTo });

    qb.orderBy('v.created_at', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage:    page,
        itemsPerPage:   limit,
        totalItems,
        totalPages,
        hasNextPage:     page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // ================================================================
  // VISITAS ACTIVAS (INSIDE) — panel en tiempo real del guardia
  // ================================================================

  async findActiveVisits(complexId: string): Promise<Visit[]> {
    return this.visitRepo.find({
      where:     { complexId, status: VisitStatus.INSIDE },
      relations: ['visitor', 'unit', 'unit.building', 'hostResident', 'hostResident.user'],
      order:     { entryTime: 'DESC' },
    });
  }

  // ================================================================
  // VISITAS PENDIENTES DE APROBACIÓN — para notificar al residente
  // ================================================================

  async findPendingApproval(complexId: string): Promise<Visit[]> {
    return this.visitRepo.find({
      where:     { complexId, status: VisitStatus.PENDING_APPROVAL },
      relations: ['visitor', 'unit', 'hostResident', 'hostResident.user'],
      order:     { createdAt: 'ASC' },
    });
  }

  // ================================================================
  // VISITAS PROGRAMADAS PARA HOY
  // ================================================================

  async findScheduledToday(complexId: string): Promise<Visit[]> {
    const today     = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow  = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.visitRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.visitor', 'visitor')
      .leftJoinAndSelect('v.unit', 'unit')
      .where('v.complex_id = :complexId', { complexId })
      .andWhere('v.type = :type', { type: VisitType.SCHEDULED })
      .andWhere('v.status = :status', { status: VisitStatus.APPROVED })
      .andWhere('v.expected_arrival_at >= :today', { today })
      .andWhere('v.expected_arrival_at < :tomorrow', { tomorrow })
      .orderBy('v.expected_arrival_at', 'ASC')
      .getMany();
  }

  // ================================================================
  // BUSCAR POR ID
  // ================================================================

  async findById(id: string, currentUser: JwtAccessPayload): Promise<Visit> {
    const visit = await this.visitRepo.findOne({
      where:     { id },
      relations: ['visitor', 'unit', 'hostResident', 'registeredByUser'],
    });

    if (!visit) {
      throw new CustomError({
        message: `Visita con ID "${id}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AccessErrorCode.VISITOR_NOT_FOUND,
      });
    }

    return visit;
  }

  // ================================================================
  // HELPER — cargar relaciones completas después de guardar
  // ================================================================

  private async loadRelations(id: string): Promise<Visit> {
    return this.visitRepo.findOne({
      where:     { id },
      relations: [
        'visitor', 'unit', 'unit.building',
        'hostResident', 'hostResident.user',
        'registeredByUser',
      ],
    });
  }
}
