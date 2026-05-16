import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { hash } from 'bcrypt';
import { randomBytes } from 'crypto';

import { Resident } from '../entities/resident.entity';
import { ResidentStatus } from '../enums/resident-status.enum';
import { ResidentType } from '../enums/resident-type.enum';
import { CreateResidentInput } from '../dto/inputs/create-resident.input';
import { UpdateResidentInput } from '../dto/inputs/update-resident.input';
import { FilterResidentsInput } from '../dto/inputs/filter-residents.input';
import { ApproveResidentInput } from '../dto/inputs/approve-resident.input';
import { RejectResidentInput } from '../dto/inputs/reject-resident.input';
import { MoveOutResidentInput } from '../dto/inputs/move-out-resident.input';
import { PaginatedResidentsResponse } from '../dto/responses/paginated-residents.response';
import { ResidentStatsResponse } from '../dto/responses/resident-stats.response';

import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { Role } from '../../roles/entities/role.entity';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { ResidentErrorCode, GeneralErrorCode, ComplexErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { UnitStatus } from '../../residential-complex/enums/unit-status.enum';
import { AuditService }    from '../../audit/services/audit.service';
import { AuditAction }     from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { CacheService }    from '../../../core/infrastructure/cache/cache.service';
import { BK, filterKey }   from '../../../core/infrastructure/cache/business-cache.constants';

@Injectable()
export class ResidentsService {
  private readonly logger = new Logger(ResidentsService.name);

  constructor(
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,

    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly cacheService: CacheService,
  ) { }

  // ================================================================
  // CREAR RESIDENTE (lo hace COMPLEX_ROL o SUPER_ADMIN)
  // Crea o reutiliza el usuario y activa el residente directamente (sin aprobación).
  // Transacción: usuario + rol + residente + unidad OCCUPIED
  // ================================================================

  async create(
    input: CreateResidentInput,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    // 1. Verificar acceso al complejo
    await this.complexService.findById(input.complexId, currentUser);

    // 2. Verificar que la unidad existe, pertenece al complejo y no está deshabilitada
    const unit = await this.unitService.findById(input.unitId, currentUser);
    if (unit.complexId !== input.complexId) {
      throw new CustomError({
        message: 'La unidad no pertenece al complejo indicado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    if (unit.status === UnitStatus.MAINTENANCE || unit.status === UnitStatus.DISABLED) {
      throw new CustomError({
        message: `La unidad N°${unit.number} está en estado "${unit.status}" y no puede recibir residentes`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: ComplexErrorCode.UNIT_IS_OCCUPIED,
      });
    }

    // 3. Buscar usuario existente (por teléfono, luego por email)
    let existingUser = await this.userRepo.findOne({
      where: { phoneNumber: input.phoneNumber.trim() },
      select: ['id', 'phoneNumber', 'email'],
    });

    if (!existingUser) {
      existingUser = await this.userRepo.findOne({
        where: { email: input.email.toLowerCase().trim() },
        select: ['id', 'phoneNumber', 'email'],
      });
    }

    const userId = existingUser?.id;

    // 4. Si el usuario ya existe, verificar que no sea ya residente ACTIVO en esta misma unidad
    // (el mismo usuario puede estar en diferentes unidades del complejo; distintos usuarios pueden
    //  compartir la misma unidad sin ningún límite)
    if (userId) {
      const alreadyInUnit = await this.residentRepo.findOne({
        where: {
          userId,
          unitId: input.unitId,
          status: ResidentStatus.ACTIVE,
          deletedAt: IsNull(),
        },
      });

      if (alreadyInUnit) {
        throw new CustomError({
          message: 'Este usuario ya figura como residente activo en esta unidad',
          statusCode: HttpStatus.CONFLICT,
          errorCode: ResidentErrorCode.USER_ALREADY_RESIDENT_IN_COMPLEX,
        });
      }
    }

    // 5. Si se marca como residente principal, verificar que no haya otro principal activo
    if (input.isMainResident) {
      await this.assertNoMainResident(input.unitId);
    }

    // 6. Ejecutar todo en una transacción
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let resolvedUserId: string;

      if (existingUser) {
        // Usar el usuario existente
        resolvedUserId = existingUser.id;
        this.logger.log(`Residente vinculado a usuario existente: ${resolvedUserId}`);
      } else {
        // Crear nuevo usuario con contraseña aleatoria y rol RESIDENTE
        const residentRole = await this.roleRepo.findOne({
          where: { name: ValidRoles.RESIDENT_ROL },
        });

        if (!residentRole) {
          throw new CustomError({
            message: `El rol '${ValidRoles.RESIDENT_ROL}' no está configurado en el sistema`,
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
          });
        }

        const dummyPassword = await hash(randomBytes(32).toString('hex'), 10);
        const systemCode = this.generateSystemCode();
        const email = input.email.trim().toLowerCase();

        const newUser = queryRunner.manager.create(User, {
          name: input.name,
          lastName: input.lastName,
          email,
          password: dummyPassword,
          phoneNumber: input.phoneNumber,
          identity: input.identityNumber,
          systemCode,
          complexId: input.complexId,
          status: UserStatus.ACTIVE,
          phoneVerified: false,
          emailVerified: false,
          identityVerified: false,
          acceptTermsAdnConditions: false,
          acceptsMarketing: false,
        });

        const savedUser = await queryRunner.manager.save(User, newUser);

        await queryRunner.manager.save(
          queryRunner.manager.create(UserRole, {
            user: { id: savedUser.id },
            role: { id: residentRole.id },
            isPrimary: true,
          }),
        );

        resolvedUserId = savedUser.id;
        this.logger.log(
          `Nuevo usuario residente creado: ${resolvedUserId} | systemCode: ${systemCode}`,
        );
      }

      // Crear el residente como ACTIVO directamente
      const resident = queryRunner.manager.create(Resident, {
        userId: resolvedUserId,
        unitId: input.unitId,
        complexId: input.complexId,
        type: input.type ?? ResidentType.OWNER,
        isMainResident: input.isMainResident ?? false,
        status: ResidentStatus.ACTIVE,
        startDate: input.startDate ? new Date(input.startDate) : new Date(),
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        emergencyContactName: input.emergencyContactName,
        emergencyContactLastName: input.emergencyContactLastName,
        emergencyContactPhone: input.emergencyContactPhone,
        notes: input.notes,
        approvedAt: new Date(),
        // Solo asignar si quien crea es un usuario real.
        // Cuando entityType === 'complex', sub es el UUID del complejo (no existe en users)
        // y causaría una FK violation en approved_by_user_id.
        approvedByUserId: currentUser.entityType === 'user' ? currentUser.sub : null,
      });

      const savedResident = await queryRunner.manager.save(Resident, resident);

      // Marcar unidad como OCCUPIED
      await queryRunner.manager.update(
        'units',
        { id: input.unitId },
        { status: UnitStatus.OCCUPIED },
      );

      await queryRunner.commitTransaction();
      await this.cacheService.deleteByPrefix(BK.resident.prefix(input.complexId));

      this.logger.log(
        `Residente creado y activado: ${savedResident.id} — usuario ${resolvedUserId} en unidad ${input.unitId}`,
      );

      void this.auditService.log({
        entityType:      AuditEntityType.Resident,
        entityId:        savedResident.id,
        action:          AuditAction.CREATE,
        newValue:        { id: savedResident.id, userId: resolvedUserId, unitId: input.unitId, complexId: input.complexId, status: ResidentStatus.ACTIVE },
        performedById:   currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId:       input.complexId,
        description:     `Residente creado: ${input.name} ${input.lastName} — unidad ${input.unitId}`,
      });

      return this.residentRepo.findOne({
        where: { id: savedResident.id },
        relations: ['user', 'unit', 'unit.building', 'complex'],
      });
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      if (error instanceof CustomError) throw error;
      this.logger.error(`Error al crear residente: ${error?.message}`, error?.stack);
      throw new CustomError({
        message: 'Error interno al crear el residente',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
      });
    } finally {
      await queryRunner.release();
    }
  }

  // ================================================================
  // APROBAR RESIDENTE (solo COMPLIANCE_OFFICER)
  // Transacción atómica: cambia estado residente + estado unidad
  // ================================================================

  async approve(
    input: ApproveResidentInput,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.findById(input.residentId, currentUser);

    if (resident.status !== ResidentStatus.PENDING_APPROVAL) {
      throw new CustomError({
        message: `El residente no está en estado PENDING_APPROVAL. Estado actual: ${resident.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ResidentErrorCode.RESIDENT_ALREADY_ACTIVE,
      });
    }

    // Transacción: aprobar residente + marcar unidad como OCCUPIED
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      resident.status = ResidentStatus.ACTIVE;
      resident.approvedAt = new Date();
      resident.approvedByUserId = currentUser.sub;
      if (input.notes) resident.notes = input.notes;

      await queryRunner.manager.save(Resident, resident);

      // Marcar unidad como ocupada
      await queryRunner.manager.update(
        'units',
        { id: resident.unitId },
        { status: UnitStatus.OCCUPIED },
      );

      await queryRunner.commitTransaction();
      await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));
      this.logger.log(
        `Residente aprobado: ${resident.id} por Compliance Officer ${currentUser.sub}`,
      );

      void this.auditService.log({
        entityType:      AuditEntityType.Resident,
        entityId:        resident.id,
        action:          AuditAction.APPROVE,
        previousValue:   { status: ResidentStatus.PENDING_APPROVAL },
        newValue:        { status: ResidentStatus.ACTIVE, approvedAt: resident.approvedAt },
        performedById:   currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId:       resident.complexId,
        description:     `Residente aprobado: ${resident.id}`,
      });

      return resident;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Error al aprobar residente', error);
      throw new CustomError({
        message: 'Error interno al aprobar el residente',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
      });
    } finally {
      await queryRunner.release();
    }
  }

  // ================================================================
  // RECHAZAR RESIDENTE (solo COMPLIANCE_OFFICER)
  // ================================================================

  async reject(
    input: RejectResidentInput,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.findById(input.residentId, currentUser);

    if (resident.status !== ResidentStatus.PENDING_APPROVAL) {
      throw new CustomError({
        message: `Solo se pueden rechazar solicitudes en estado PENDING_APPROVAL. Estado actual: ${resident.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    resident.status = ResidentStatus.REJECTED;
    resident.rejectionReason = input.rejectionReason;
    resident.approvedByUserId = currentUser.sub;

    const saved = await this.residentRepo.save(resident);
    await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));
    this.logger.warn(`Residente rechazado: ${resident.id} — razón: ${input.rejectionReason}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Resident,
      entityId:        resident.id,
      action:          AuditAction.REJECT,
      previousValue:   { status: ResidentStatus.PENDING_APPROVAL },
      newValue:        { status: ResidentStatus.REJECTED, rejectionReason: input.rejectionReason },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       resident.complexId,
      description:     `Residente rechazado: ${resident.id} — razón: ${input.rejectionReason}`,
    });

    return saved;
  }

  // ================================================================
  // REGISTRAR MUDANZA (MOVED_OUT) — COMPLEX_ROL o SUPER_ADMIN
  // Si no quedan más residentes activos en la unidad → AVAILABLE
  // ================================================================

  async moveOut(
    input: MoveOutResidentInput,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.findById(input.residentId, currentUser);

    if (resident.status !== ResidentStatus.ACTIVE && resident.status !== ResidentStatus.SUSPENDED) {
      throw new CustomError({
        message: `No se puede registrar mudanza para un residente en estado ${resident.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      resident.status = ResidentStatus.MOVED_OUT;
      resident.moveOutDate = input.moveOutDate ? new Date(input.moveOutDate) : new Date();
      resident.moveOutReason = input.moveOutReason ?? null;

      await queryRunner.manager.save(Resident, resident);

      // Verificar si quedan residentes ACTIVOS en la misma unidad
      const remainingActiveCount = await queryRunner.manager.count(Resident, {
        where: {
          unitId: resident.unitId,
          status: ResidentStatus.ACTIVE,
          deletedAt: IsNull(),
          id: Not(resident.id),
        },
      });

      // Si no quedan residentes activos, liberar la unidad
      if (remainingActiveCount === 0) {
        await queryRunner.manager.update(
          'units',
          { id: resident.unitId },
          { status: UnitStatus.AVAILABLE },
        );
        this.logger.log(`Unidad ${resident.unitId} liberada (sin residentes activos)`);
      }

      await queryRunner.commitTransaction();
      await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));
      this.logger.log(`Residente ${resident.id} registrado como MOVED_OUT`);

      void this.auditService.log({
        entityType:      AuditEntityType.Resident,
        entityId:        resident.id,
        action:          AuditAction.UPDATE,
        previousValue:   { status: ResidentStatus.ACTIVE },
        newValue:        { status: ResidentStatus.MOVED_OUT, moveOutDate: resident.moveOutDate, moveOutReason: resident.moveOutReason },
        performedById:   currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId:       resident.complexId,
        description:     `Residente dado de baja (MOVED_OUT): ${resident.id}`,
      });

      return resident;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Error al registrar mudanza', error);
      throw new CustomError({
        message: 'Error interno al registrar la mudanza',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
      });
    } finally {
      await queryRunner.release();
    }
  }

  // ================================================================
  // DESHACER BAJA (MOVED_OUT → ACTIVE) — COMPLEX_ROL o SUPER_ADMIN
  // Revierte el moveOut: reactiva el residente y marca la unidad OCCUPIED.
  // ================================================================

  async undoMoveOut(
    residentId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.findById(residentId, currentUser);

    if (resident.status !== ResidentStatus.MOVED_OUT) {
      throw new CustomError({
        message: `Solo se puede deshacer la baja de residentes en estado MOVED_OUT. Estado actual: "${resident.status}"`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      resident.status = ResidentStatus.ACTIVE;
      resident.moveOutDate = null;
      resident.moveOutReason = null;

      await queryRunner.manager.save(Resident, resident);

      await queryRunner.manager.update(
        'units',
        { id: resident.unitId },
        { status: UnitStatus.OCCUPIED },
      );

      await queryRunner.commitTransaction();
      await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));
      this.logger.log(`Baja del residente ${resident.id} revertida → ACTIVE`);

      return this.residentRepo.findOne({
        where: { id: resident.id },
        relations: ['user', 'unit', 'unit.building', 'complex'],
      });
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error al deshacer la baja del residente: ${error?.message}`, error?.stack);
      throw new CustomError({
        message: 'Error interno al deshacer la baja del residente',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
      });
    } finally {
      await queryRunner.release();
    }
  }

  // ================================================================
  // SUSPENDER / REACTIVAR — COMPLEX_ROL o SUPER_ADMIN
  // ================================================================

  async suspend(
    residentId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.findById(residentId, currentUser);

    if (resident.status !== ResidentStatus.ACTIVE) {
      throw new CustomError({
        message: 'Solo se pueden suspender residentes activos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    resident.status = ResidentStatus.SUSPENDED;
    resident.notes = reason;
    const savedSuspend = await this.residentRepo.save(resident);
    await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));

    void this.auditService.log({
      entityType:      AuditEntityType.Resident,
      entityId:        residentId,
      action:          AuditAction.SUSPEND,
      previousValue:   { status: ResidentStatus.ACTIVE },
      newValue:        { status: ResidentStatus.SUSPENDED, reason },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       resident.complexId,
      description:     `Residente suspendido: ${residentId} — razón: ${reason}`,
    });

    return savedSuspend;
  }

  async reactivate(
    residentId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.findById(residentId, currentUser);

    if (resident.status !== ResidentStatus.SUSPENDED) {
      throw new CustomError({
        message: 'Solo se pueden reactivar residentes suspendidos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    resident.status = ResidentStatus.ACTIVE;
    const savedReactivate = await this.residentRepo.save(resident);
    await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));

    void this.auditService.log({
      entityType:      AuditEntityType.Resident,
      entityId:        residentId,
      action:          AuditAction.ACTIVATE,
      previousValue:   { status: ResidentStatus.SUSPENDED },
      newValue:        { status: ResidentStatus.ACTIVE },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       resident.complexId,
      description:     `Residente reactivado: ${residentId}`,
    });

    return savedReactivate;
  }

  // ================================================================
  // ACTUALIZAR DATOS BÁSICOS — COMPLEX_ROL o SUPER_ADMIN
  // ================================================================

  async update(
    input: UpdateResidentInput,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.findById(input.id, currentUser);

    if (
      resident.status === ResidentStatus.MOVED_OUT ||
      resident.status === ResidentStatus.REJECTED
    ) {
      throw new CustomError({
        message: 'No se puede actualizar un residente que ya salió o fue rechazado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // Si se cambia isMainResident a true, verificar que no haya otro principal
    if (input.isMainResident === true && !resident.isMainResident) {
      await this.assertNoMainResident(resident.unitId, resident.id);
    }

    Object.assign(resident, input);
    const savedUpdate = await this.residentRepo.save(resident);
    await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));
    return savedUpdate;
  }

  // ================================================================
  // LISTAR — con filtros y paginación
  // ================================================================

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterResidentsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedResidentsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const cacheKey = BK.resident.list(complexId, page, limit, filterKey(filters ?? {}));
    const cached = await this.cacheService.get<PaginatedResidentsResponse>({ key: cacheKey });
    if (cached) return cached;

    const skip = (page - 1) * limit;

    const qb = this.residentRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'user')
      .leftJoinAndSelect('r.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .leftJoinAndSelect('r.approvedByUser', 'approvedByUser')
      .where('r.complex_id = :complexId', { complexId })
      // .andWhere('r.createdAt IS NULL');

    if (filters?.status)       qb.andWhere('r.status = :status', { status: filters.status });
    if (filters?.type)         qb.andWhere('r.type = :type', { type: filters.type });
    if (filters?.unitId)       qb.andWhere('r.unit_id = :unitId', { unitId: filters.unitId });
    if (filters?.buildingId)   qb.andWhere('unit.building_id = :bid', { bid: filters.buildingId });
    if (filters?.unitType)     qb.andWhere('unit.type = :unitType', { unitType: filters.unitType });
    if (filters?.unitNumber)   qb.andWhere('UPPER(unit.number) = UPPER(:unitNumber)', { unitNumber: filters.unitNumber.trim() });
    if (filters?.buildingName) qb.andWhere('UPPER(building.name) = UPPER(:buildingName)', { buildingName: filters.buildingName.trim() });

    if (filters?.search) {
      qb.andWhere(
        `(user.name ILIKE :search
          OR user.last_name ILIKE :search
          OR user.email ILIKE :search
          OR user.number_phone ILIKE :search)`,
        { search: `%${filters.search}%` },
      );
    }

    qb.orderBy('r.createdAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    const result: PaginatedResidentsResponse = {
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

    await this.cacheService.set({ key: cacheKey, data: result, options: { ttl: BK.resident.TTL } });
    return result;
  }

  // ================================================================
  // SOLICITUDES PENDIENTES — para el dashboard del COMPLIANCE_OFFICER
  // ================================================================

  async findPending(
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedResidentsResponse> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.residentRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'user')
      .leftJoinAndSelect('r.unit', 'unit')
      .leftJoinAndSelect('r.complex', 'complex')
      .where('r.status = :status', { status: ResidentStatus.PENDING_APPROVAL })
      .andWhere('r.deleted_at IS NULL')
      .orderBy('r.created_at', 'ASC') // Los más antiguos primero
      .skip(skip)
      .take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

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

  // ================================================================
  // BUSCAR POR ID
  // ================================================================

  async findById(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    const resident = await this.residentRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['user', 'unit', 'unit.building', 'complex', 'approvedByUser'],
    });

    if (!resident) {
      throw new CustomError({
        message: `Residente con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ResidentErrorCode.RESIDENT_NOT_FOUND,
      });
    }

    // Verificar acceso: COMPLIANCE_OFFICER puede ver todos los pendientes;
    // el resto solo puede ver los de su complejo
    const isSuperAdmin = currentUser.roles.includes(ValidRoles.SUPER_ADMIN_ROL);
    const isCompliance = currentUser.roles.includes(ValidRoles.COMPILANCE_OFFICER_ROL);

    if (!isSuperAdmin && !isCompliance) {
      await this.complexService.assertAccess(resident.complex, currentUser);
    }

    return resident;
  }

  // ================================================================
  // SOFT DELETE
  // ================================================================

  async remove(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    const resident = await this.findById(id, currentUser);

    if (resident.status === ResidentStatus.ACTIVE) {
      throw new CustomError({
        message: 'No se puede eliminar un residente activo. Regístralo como MOVED_OUT primero.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ResidentErrorCode.RESIDENT_ALREADY_ACTIVE,
      });
    }

    resident.deletedAt = new Date();
    await this.residentRepo.save(resident);
    await this.cacheService.deleteByPrefix(BK.resident.prefix(resident.complexId));
    this.logger.warn(`Residente eliminado (soft): ${id}`);

    return {
      success: true,
      message: `Registro de residente eliminado correctamente`,
    };
  }

  // ================================================================
  // HISTORIAL DE RESIDENTES DE UNA UNIDAD
  // ================================================================

  async findHistoryByUnit(
    unitId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Resident[]> {
    const unit = await this.unitService.findById(unitId, currentUser);
    await this.complexService.findById(unit.complexId, currentUser);

    return this.residentRepo.find({
      where: { unitId },
      relations: ['user', 'approvedByUser'],
      order: { createdAt: 'DESC' },
    });
  }

  // ================================================================
  // ESTADÍSTICAS DEL COMPLEJO
  // ================================================================

  async getStats(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ResidentStatsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const cacheKey = BK.resident.stats(complexId);
    const cached = await this.cacheService.get<ResidentStatsResponse>({ key: cacheKey });
    if (cached) return cached;

    const raw = await this.residentRepo
      .createQueryBuilder('r')
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(CASE WHEN r.status = 'ACTIVE' THEN 1 END)`, 'active')
      .addSelect(`COUNT(CASE WHEN r.status = 'PENDING_APPROVAL' THEN 1 END)`, 'pendingApproval')
      .addSelect(`COUNT(CASE WHEN r.status = 'SUSPENDED' THEN 1 END)`, 'suspended')
      .addSelect(`COUNT(CASE WHEN r.status = 'MOVED_OUT' THEN 1 END)`, 'movedOut')
      .addSelect(`COUNT(CASE WHEN r.status = 'REJECTED' THEN 1 END)`, 'rejected')
      .addSelect(`COUNT(CASE WHEN r.is_main_resident = true AND r.status = 'ACTIVE' THEN 1 END)`, 'mainResidents')
      .addSelect(`COUNT(CASE WHEN r.type = 'OWNER' AND r.status = 'ACTIVE' THEN 1 END)`, 'owners')
      .addSelect(`COUNT(CASE WHEN r.type = 'TENANT' AND r.status = 'ACTIVE' THEN 1 END)`, 'tenants')
      .addSelect(`COUNT(CASE WHEN r.type = 'FAMILY_MEMBER' AND r.status = 'ACTIVE' THEN 1 END)`, 'familyMembers')
      .addSelect(`COUNT(CASE WHEN r.type = 'CARETAKER' AND r.status = 'ACTIVE' THEN 1 END)`, 'caretakers')
      .where('r.complex_id = :complexId', { complexId })
      .andWhere('r.deleted_at IS NULL')
      .getRawOne<Record<string, string>>();

    const n = (key: string) => parseInt(raw[key] ?? '0', 10);

    const stats: ResidentStatsResponse = {
      total:          n('total'),
      active:         n('active'),
      pendingApproval: n('pendingApproval'),
      suspended:      n('suspended'),
      movedOut:       n('movedOut'),
      rejected:       n('rejected'),
      mainResidents:  n('mainResidents'),
      byType: {
        owners:        n('owners'),
        tenants:       n('tenants'),
        familyMembers: n('familyMembers'),
        caretakers:    n('caretakers'),
      },
    };

    await this.cacheService.set({ key: cacheKey, data: stats, options: { ttl: BK.resident.TTL } });
    return stats;
  }

  // ================================================================
  // MÉTODO PÚBLICO PARA USO INTERNO DE OTROS MÓDULOS
  // ================================================================

  /**
   * Devuelve los residentes ACTIVOS de una unidad sin validar acceso.
   * Pensado para uso interno (PackagesService → notificar al residente).
   */
  async findActiveByUnitInternal(unitId: string): Promise<Resident[]> {
    return this.residentRepo.find({
      where: { unitId, status: ResidentStatus.ACTIVE, deletedAt: IsNull() },
    });
  }

  /** Devuelve los userId de todos los residentes activos de un complejo (uso interno). */
  async findActiveUserIdsByComplexInternal(complexId: string): Promise<string[]> {
    const residents = await this.residentRepo.find({
      select: ['userId'],
      where: { complexId, status: ResidentStatus.ACTIVE, deletedAt: IsNull() },
    });
    return residents.map(r => r.userId).filter(Boolean) as string[];
  }

  /**
   * Devuelve el residente activo de un usuario en un complejo, con la unidad
   * y el edificio cargados. Retorna null si no existe.
   */
  async findActiveResidentByUserIdInternal(userId: string, complexId: string): Promise<Resident | null> {
    return this.residentRepo.findOne({
      where:     { userId, complexId, status: ResidentStatus.ACTIVE, deletedAt: IsNull() },
      relations: ['unit', 'unit.building'],
    });
  }

  /**
   * Devuelve los userId de todos los residentes activos de un edificio (uso interno).
   * Útil para alertas de pánico en edificios/torres.
   */
  async findActiveUserIdsByBuildingInternal(buildingId: string): Promise<string[]> {
    const residents = await this.residentRepo
      .createQueryBuilder('r')
      .innerJoin('r.unit', 'u')
      .where('u.building_id = :buildingId', { buildingId })
      .andWhere('r.status = :status', { status: ResidentStatus.ACTIVE })
      .andWhere('r.deleted_at IS NULL')
      .select('r.user_id', 'userId')
      .getRawMany<{ userId: string }>();
    return residents.map(r => r.userId).filter(Boolean);
  }

  // ================================================================
  // HELPER INTERNO
  // ================================================================

  /** Genera un código de sistema legible para el residente (ej: RES-A3F9-K2M1) */
  private generateSystemCode(): string {
    const p1 = randomBytes(2).toString('hex').toUpperCase();
    const p2 = randomBytes(2).toString('hex').toUpperCase();
    return `RES-${p1}-${p2}`;
  }

  /**
   * Verifica que no exista ya un residente principal activo en la unidad.
   * @param excludeId ID a excluir de la búsqueda (para updates)
   */
  private async assertNoMainResident(unitId: string, excludeId?: string): Promise<void> {
    const qb = this.residentRepo
      .createQueryBuilder('r')
      .where('r.unit_id = :unitId', { unitId })
      .andWhere('r.is_main_resident = true')
      .andWhere('r.status = :status', { status: ResidentStatus.ACTIVE })
      .andWhere('r.deleted_at IS NULL');

    if (excludeId) qb.andWhere('r.id != :excludeId', { excludeId });

    const existing = await qb.getOne();
    if (existing) {
      throw new CustomError({
        message: 'Ya existe un residente principal activo en esta unidad',
        statusCode: HttpStatus.CONFLICT,
        errorCode: ResidentErrorCode.RESIDENT_ALREADY_MAIN,
      });
    }
  }
}
