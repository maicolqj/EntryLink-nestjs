import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { Vehicle }               from '../entities/vehicle.entity';
import { VehicleStatus }         from '../enums/vehicle-status.enum';
import { VehicleType }           from '../enums/vehicle-type.enum';
import { RotationIntervalUnit }  from '../enums/rotation-interval-unit.enum';
import { RegisterVehicleInput }  from '../dto/inputs/register-vehicle.input';
import { UpdateVehicleInput }    from '../dto/inputs/update-vehicle.input';
import { FilterVehiclesInput }   from '../dto/inputs/filter-vehicles.input';
import { ApproveVehicleInput }   from '../dto/inputs/approve-vehicle.input';
import { ConfigureRotationInput } from '../dto/inputs/configure-rotation.input';
import { PaginatedVehiclesResponse } from '../dto/responses/paginated-vehicles.response';
import { PlateCheckResponse }    from '../dto/responses/plate-check.response';
import { RotationStatusResponse, RotationTypeStatus } from '../dto/responses/rotation-status.response';
import { ParkingRotationConfig } from '../entities/parking-rotation-config.entity';

import { PaginationInput }           from '../../shared/dto/inputs/pagination.input';
import { CustomError }               from '../../shared/utils/errors.utils';
import { GeneralErrorCode, LogisticsErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }          from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }                from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { AuditService }              from '../../audit/services/audit.service';
import { AuditAction }               from '../../audit/enums/audit-action.enum';
import { AuditEntityType }           from '../../audit/enums/audit-entity-type.enum';
import { UnitService }               from '../../residential-complex/services/unit.service';
import { ResidentsService }          from '../../residents/services/residents.service';

// Tipos de vehículo que NO ocupan cupo de parqueadero vehicular
const NON_PARKING_TYPES = new Set([VehicleType.BICYCLE, VehicleType.ELECTRIC_SCOOTER]);

// Estados que cuentan como "registro activo" (bloquean placa duplicada)
const ACTIVE_STATES = [VehicleStatus.PENDING_APPROVAL, VehicleStatus.ACTIVE, VehicleStatus.SUSPENDED];

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(ParkingRotationConfig)
    private readonly rotationConfigRepo: Repository<ParkingRotationConfig>,
    private readonly complexService:   ResidentialComplexService,
    private readonly unitService:      UnitService,
    private readonly residentsService: ResidentsService,
    private readonly auditService:     AuditService,
  ) {}

  // ================================================================
  // REGISTRAR VEHÍCULO
  // ================================================================

  async register(
    input: RegisterVehicleInput,
    currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    // 1. Verificar acceso al complejo
    await this.complexService.findById(input.complexId, currentUser);

    // 2. Verificar que la unidad existe y pertenece al complejo
    const unit = await this.unitService.findById(input.unitId, currentUser);

    if (unit.complexId !== input.complexId) {
      throw new CustomError({
        message: 'La unidad no pertenece al complejo indicado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const plate = input.plate.toUpperCase().replace(/[\s\-]/g, '');

    // 3. Verificar que la placa no esté ya activa en el complejo
    const plateConflict = await this.vehicleRepo.findOne({
      where: {
        complexId: input.complexId,
        plate,
        status:    In(ACTIVE_STATES),
        deletedAt: IsNull(),
      },
    });

    if (plateConflict) {
      throw new CustomError({
        message: `La placa "${plate}" ya está registrada en este complejo`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: LogisticsErrorCode.VEHICLE_ALREADY_IN_COMPLEX,
      });
    }

    // 4. Verificar cupos de parqueadero de la unidad (solo para vehículos que ocupan cupo)
    const needsParkingSlot = !NON_PARKING_TYPES.has(input.type ?? VehicleType.CAR);

    if (needsParkingSlot) {
      await this.assertParkingAvailable(input.unitId, input.complexId);
    }

    // 5. Crear el vehículo
    const vehicle = this.vehicleRepo.create({
      ...input,
      plate,
      status: VehicleStatus.ACTIVE,
    });

    const saved = await this.vehicleRepo.save(vehicle);
    this.logger.log(
      `Vehículo registrado: ${saved.id} — placa ${plate} — unidad ${input.unitId}`,
    );

    void this.auditService.log({
      entityType:      AuditEntityType.Vehicle,
      entityId:        saved.id,
      action:          AuditAction.CREATE,
      newValue:        { id: saved.id, plate: saved.plate, type: saved.type, status: saved.status, unitId: input.unitId, complexId: input.complexId },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       input.complexId,
      description:     `Vehículo registrado: placa ${plate} — unidad ${input.unitId}`,
    });

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // APROBAR VEHÍCULO (COMPLEX_ROL o SUPERVISOR_ROL)
  // ================================================================

  async approve(
    input: ApproveVehicleInput,
    currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    const vehicle = await this.findById(input.vehicleId, currentUser);

    if (vehicle.status !== VehicleStatus.PENDING_APPROVAL) {
      throw new CustomError({
        message: `El vehículo no está en estado PENDING_APPROVAL. Estado actual: ${vehicle.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    vehicle.status           = VehicleStatus.ACTIVE;
    vehicle.approvedAt       = new Date();
    vehicle.approvedByUserId = currentUser.sub;
    if (input.parkingSpot) vehicle.parkingSpot = input.parkingSpot;
    if (input.notes)       vehicle.notes        = input.notes;

    const saved = await this.vehicleRepo.save(vehicle);
    this.logger.log(`Vehículo aprobado: ${vehicle.id} — placa ${vehicle.plate}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Vehicle,
      entityId:        vehicle.id,
      action:          AuditAction.APPROVE,
      previousValue:   { status: VehicleStatus.PENDING_APPROVAL },
      newValue:        { status: VehicleStatus.ACTIVE, parkingSpot: input.parkingSpot },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       vehicle.complexId,
      description:     `Vehículo aprobado: placa ${vehicle.plate}`,
    });

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // RECHAZAR VEHÍCULO (COMPLEX_ROL o SUPERVISOR_ROL)
  // ================================================================

  async reject(
    vehicleId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    const vehicle = await this.findById(vehicleId, currentUser);

    if (vehicle.status !== VehicleStatus.PENDING_APPROVAL) {
      throw new CustomError({
        message: `Solo se pueden rechazar vehículos en PENDING_APPROVAL. Estado: ${vehicle.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    vehicle.status           = VehicleStatus.REJECTED;
    vehicle.rejectionReason  = reason;
    vehicle.approvedByUserId = currentUser.sub;

    this.logger.warn(`Vehículo rechazado: ${vehicle.id} — razón: ${reason}`);
    const saved = await this.vehicleRepo.save(vehicle);

    void this.auditService.log({
      entityType:      AuditEntityType.Vehicle,
      entityId:        vehicle.id,
      action:          AuditAction.REJECT,
      previousValue:   { status: VehicleStatus.PENDING_APPROVAL },
      newValue:        { status: VehicleStatus.REJECTED, reason },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       vehicle.complexId,
      description:     `Vehículo rechazado: placa ${vehicle.plate} — razón: ${reason}`,
    });

    return saved;
  }

  // ================================================================
  // SUSPENDER / REACTIVAR (SUPERVISOR_ROL o COMPLEX_ROL)
  // ================================================================

  async suspend(
    vehicleId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    const vehicle = await this.findById(vehicleId, currentUser);

    if (vehicle.status !== VehicleStatus.ACTIVE) {
      throw new CustomError({
        message: 'Solo se pueden suspender vehículos activos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    vehicle.status          = VehicleStatus.SUSPENDED;
    vehicle.rejectionReason = reason;
    this.logger.warn(`Vehículo suspendido: ${vehicle.id} — ${vehicle.plate}`);
    const savedSuspend = await this.vehicleRepo.save(vehicle);

    void this.auditService.log({
      entityType:      AuditEntityType.Vehicle,
      entityId:        vehicle.id,
      action:          AuditAction.SUSPEND,
      previousValue:   { status: VehicleStatus.ACTIVE },
      newValue:        { status: VehicleStatus.SUSPENDED, reason },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       vehicle.complexId,
      description:     `Vehículo suspendido: placa ${vehicle.plate} — razón: ${reason}`,
    });

    return savedSuspend;
  }

  async reactivate(
    vehicleId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    const vehicle = await this.findById(vehicleId, currentUser);

    if (vehicle.status !== VehicleStatus.SUSPENDED) {
      throw new CustomError({
        message: 'Solo se pueden reactivar vehículos suspendidos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    vehicle.status          = VehicleStatus.ACTIVE;
    vehicle.rejectionReason = null;
    const savedReactivate = await this.vehicleRepo.save(vehicle);

    void this.auditService.log({
      entityType:      AuditEntityType.Vehicle,
      entityId:        vehicle.id,
      action:          AuditAction.ACTIVATE,
      previousValue:   { status: VehicleStatus.SUSPENDED },
      newValue:        { status: VehicleStatus.ACTIVE },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       vehicle.complexId,
      description:     `Vehículo reactivado: placa ${vehicle.plate}`,
    });

    return savedReactivate;
  }

  // ================================================================
  // RETIRAR DEL COMPLEJO (permanente — COMPLEX_ROL)
  // ================================================================

  async remove(
    vehicleId: string,
    currentUser: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    const vehicle = await this.findById(vehicleId, currentUser);

    if (vehicle.status === VehicleStatus.REMOVED) {
      throw new CustomError({
        message: 'El vehículo ya fue retirado del complejo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    vehicle.status    = VehicleStatus.REMOVED;
    vehicle.deletedAt = new Date();
    await this.vehicleRepo.save(vehicle);

    this.logger.log(`Vehículo retirado: ${vehicleId} — placa ${vehicle.plate}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Vehicle,
      entityId:        vehicleId,
      action:          AuditAction.DELETE,
      previousValue:   { status: vehicle.status },
      newValue:        { status: VehicleStatus.REMOVED, deletedAt: vehicle.deletedAt },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       vehicle.complexId,
      description:     `Vehículo retirado del complejo: placa ${vehicle.plate}`,
    });

    return {
      success: true,
      message: `Vehículo con placa ${vehicle.plate} retirado del complejo`,
    };
  }

  // ================================================================
  // ACTUALIZAR DATOS (COMPLEX_ROL o propietario)
  // ================================================================

  async update(
    input: UpdateVehicleInput,
    currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    const vehicle = await this.findById(input.id, currentUser);

    const nonUpdatableStates = [VehicleStatus.REMOVED, VehicleStatus.REJECTED];
    if (nonUpdatableStates.includes(vehicle.status)) {
      throw new CustomError({
        message: `No se puede actualizar un vehículo en estado ${vehicle.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    Object.assign(vehicle, input);
    return this.vehicleRepo.save(vehicle);
  }

  // ================================================================
  // CONSULTA DE PLACA — para portería (SECURITY_ROL)
  // ================================================================

  async checkPlate(plate: string, complexId: string): Promise<PlateCheckResponse> {
    const normalizedPlate = plate.toUpperCase().replace(/[\s\-]/g, '');

    const vehicle = await this.vehicleRepo.findOne({
      where: {
        complexId,
        plate: normalizedPlate,
        status: Not(In([VehicleStatus.REMOVED])),
        deletedAt: IsNull(),
      },
      relations: ['resident', 'resident.user', 'unit', 'unit.building'],
    });

    if (!vehicle) {
      return {
        isRegistered: false,
        isAuthorized: false,
        message: `La placa "${normalizedPlate}" NO está registrada en este complejo`,
      };
    }

    const isAuthorized = vehicle.status === VehicleStatus.ACTIVE;

    const messages: Record<VehicleStatus, string> = {
      [VehicleStatus.ACTIVE]:           `✅ Vehículo autorizado. Residente: ${vehicle.resident?.user?.fullName ?? 'N/A'} — Unidad: ${vehicle.unit?.number ?? 'N/A'}`,
      [VehicleStatus.PENDING_APPROVAL]: `⚠️ Vehículo en espera de aprobación. No autorizar ingreso aún.`,
      [VehicleStatus.SUSPENDED]:        `🚫 Vehículo SUSPENDIDO. No permitir ingreso. Contactar administración.`,
      [VehicleStatus.REJECTED]:         `❌ Vehículo RECHAZADO. No autorizado.`,
      [VehicleStatus.REMOVED]:          `❌ Vehículo RETIRADO del complejo.`,
    };

    return {
      isRegistered: true,
      isAuthorized,
      message:      messages[vehicle.status],
      vehicle,
    };
  }

  // ================================================================
  // LISTAR VEHÍCULOS DEL COMPLEJO
  // ================================================================

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterVehiclesInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedVehiclesResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.vehicleRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.resident', 'resident')
      .leftJoinAndSelect('resident.user', 'user')
      .leftJoinAndSelect('v.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .where('v.complex_id = :complexId', { complexId })
      .andWhere('v.deleted_at IS NULL');

    if (filters?.status)     qb.andWhere('v.status = :status',         { status: filters.status });
    if (filters?.type)       qb.andWhere('v.type = :type',             { type: filters.type });
    if (filters?.residentId) qb.andWhere('v.resident_id = :rid',       { rid: filters.residentId });
    if (filters?.unitId)     qb.andWhere('v.unit_id = :uid',           { uid: filters.unitId });

    if (filters?.search) {
      qb.andWhere(
        `(v.plate ILIKE :s OR v.brand ILIKE :s OR v.model ILIKE :s OR v.color ILIKE :s)`,
        { s: `%${filters.search}%` },
      );
    }

    qb.orderBy('v.createdAt', 'DESC').skip(skip).take(limit);

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
  // VEHÍCULOS DE UN RESIDENTE ESPECÍFICO
  // ================================================================

  async findByResident(
    residentId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Vehicle[]> {
    await this.residentsService.findById(residentId, currentUser);

    return this.vehicleRepo.find({
      where:     { residentId, deletedAt: IsNull() },
      relations: ['unit', 'unit.building', 'approvedByUser'],
      order:     { createdAt: 'DESC' },
    });
  }

  // ================================================================
  // SOLICITUDES PENDIENTES DEL COMPLEJO
  // ================================================================

  async findPending(complexId: string, currentUser: JwtAccessPayload): Promise<Vehicle[]> {
    await this.complexService.findById(complexId, currentUser);

    return this.vehicleRepo.find({
      where:     { complexId, status: VehicleStatus.PENDING_APPROVAL, deletedAt: IsNull() },
      relations: ['resident', 'resident.user', 'unit'],
      order:     { createdAt: 'ASC' },
    });
  }

  // ================================================================
  // BUSCAR POR ID
  // ================================================================

  async findById(id: string, currentUser: JwtAccessPayload): Promise<Vehicle> {
    const vehicle = await this.vehicleRepo.findOne({
      where:     { id, deletedAt: IsNull() },
      relations: ['resident', 'resident.user', 'unit', 'unit.building', 'approvedByUser'],
    });

    if (!vehicle) {
      throw new CustomError({
        message: `Vehículo con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: LogisticsErrorCode.VEHICLE_NOT_FOUND,
      });
    }

    // Verificar acceso al complejo (salvo SUPER_ADMIN)
    const isSuperAdmin = currentUser.roles.includes(ValidRoles.SUPER_ADMIN_ROL);
    if (!isSuperAdmin) {
      await this.complexService.assertAccess(
        { id: vehicle.complexId, ownerId: vehicle.complex } as any,
        currentUser,
      );
    }

    return vehicle;
  }

  // ================================================================
  // CONFIGURAR ROTACIÓN DE PARQUEADEROS
  // ================================================================

  async configureRotation(
    input: ConfigureRotationInput,
    currentUser: JwtAccessPayload,
  ): Promise<ParkingRotationConfig> {
    await this.complexService.findById(input.complexId, currentUser);

    // Convertir array de slots a mapa { vehicleType: slots }
    const slotsByType: Record<string, number> = {};
    for (const entry of input.slotsByType) {
      slotsByType[entry.vehicleType.toUpperCase()] = entry.slots;
    }

    let config = await this.rotationConfigRepo.findOne({
      where: { complexId: input.complexId },
    });

    const actorUserId = currentUser.entityType === 'user' ? currentUser.sub : null;

    if (!config) {
      config = this.rotationConfigRepo.create({
        complexId:              input.complexId,
        rotationIntervalValue:  input.rotationIntervalValue,
        rotationIntervalUnit:   input.rotationIntervalUnit,
        slotsByType,
        isActive:               input.isActive ?? true,
        grandCycleByType:       {},
        createdByUserId:        actorUserId,
      });
    } else {
      config.rotationIntervalValue = input.rotationIntervalValue;
      config.rotationIntervalUnit  = input.rotationIntervalUnit;
      config.slotsByType           = slotsByType;
      if (input.isActive !== undefined) config.isActive = input.isActive;
      config.updatedByUserId = actorUserId;
    }

    // Calcular próxima ejecución desde ahora
    config.nextExecutionAt = this.calcNextExecution(
      config.lastExecutedAt ?? new Date(),
      input.rotationIntervalValue,
      input.rotationIntervalUnit,
    );

    const saved = await this.rotationConfigRepo.save(config);
    this.logger.log(
      `Rotación configurada para complejo ${input.complexId}: ` +
      `cada ${input.rotationIntervalValue} ${input.rotationIntervalUnit} — ` +
      `cupos: ${JSON.stringify(slotsByType)}`,
    );
    return this.rotationConfigRepo.findOne({
      where: { id: saved.id },
      relations: ['createdByUser', 'updatedByUser'],
    });
  }

  // ================================================================
  // EJECUTAR ROTACIÓN
  // ================================================================

  /**
   * Ejecuta un ciclo de rotación para el complejo.
   *
   * Por cada tipo de vehículo configurado en slotsByType:
   *  1. Reactivar los vehículos actualmente fuera por rotación de ese tipo.
   *  2. Si todos los del pool han rotado al menos una vez → reiniciar gran ciclo.
   *  3. Seleccionar los K vehículos con menor rotationCycleCount (y más antiguos
   *     en caso de empate) y suspenderlos con razón "Fuera por rotación".
   *
   * El algoritmo garantiza equidad: ningún vehículo repite hasta que todos
   * los demás hayan pasado por la suspensión al menos una vez.
   */
  async executeRotation(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<RotationStatusResponse> {
    await this.complexService.findById(complexId, currentUser);

    const config = await this.rotationConfigRepo.findOne({ where: { complexId } });

    if (!config) {
      throw new CustomError({
        message:    'No hay configuración de rotación para este complejo. Configure primero con configureParkingRotation.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode:  LogisticsErrorCode.ROTATION_CONFIG_NOT_FOUND,
      });
    }

    if (!config.isActive) {
      throw new CustomError({
        message:    'La rotación de parqueaderos está desactivada para este complejo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode:  LogisticsErrorCode.ROTATION_INACTIVE,
      });
    }

    const configuredTypes = Object.keys(config.slotsByType);
    if (configuredTypes.length === 0) {
      throw new CustomError({
        message:    'No hay tipos de vehículo configurados en slotsByType',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode:  LogisticsErrorCode.ROTATION_NOT_NEEDED,
      });
    }

    const now = new Date();
    const grandCycleByType = { ...config.grandCycleByType };
    const vehiclesToSave: Vehicle[] = [];

    for (const vehicleType of configuredTypes) {
      const availableSlots = config.slotsByType[vehicleType] ?? 0;

      // Pool = vehículos activos O suspendidos por rotación de este tipo
      const pool = await this.vehicleRepo
        .createQueryBuilder('v')
        .where('v.complex_id = :complexId', { complexId })
        .andWhere('v.type = :type', { type: vehicleType })
        .andWhere('v.deleted_at IS NULL')
        .andWhere(
          '(v.status = :active OR (v.status = :suspended AND v.suspended_by_rotation = TRUE))',
          { active: VehicleStatus.ACTIVE, suspended: VehicleStatus.SUSPENDED },
        )
        .orderBy('v.rotation_cycle_count', 'ASC')
        .addOrderBy('v.rotation_suspended_at', 'ASC', 'NULLS FIRST')
        .getMany();

      const totalVehicles = pool.length;
      const excessCount   = totalVehicles - availableSlots;

      if (excessCount <= 0) {
        this.logger.log(
          `[${vehicleType}] Sin exceso (${totalVehicles} vehículos, ${availableSlots} cupos) — sin rotación`,
        );
        continue;
      }

      // Paso 1: Reactivar los que están fuera por rotación
      const currentlyRotated = pool.filter(v => v.suspendedByRotation);
      for (const v of currentlyRotated) {
        v.status             = VehicleStatus.ACTIVE;
        v.suspendedByRotation = false;
        v.rejectionReason    = null;
      }

      // Paso 2: Reinicio de gran ciclo si todos han rotado al menos una vez
      const allHaveRotated = pool.every(v => v.rotationCycleCount > 0);
      if (allHaveRotated) {
        pool.forEach(v => (v.rotationCycleCount = 0));
        grandCycleByType[vehicleType] = (grandCycleByType[vehicleType] ?? 1) + 1;
        this.logger.log(
          `[${vehicleType}] Gran ciclo completado — iniciando ciclo ${grandCycleByType[vehicleType]}`,
        );
      }

      // Paso 3: Seleccionar candidatos a suspender
      // Orden: menor rotationCycleCount primero, luego rotationSuspendedAt más antiguo (nulls primero)
      const sorted = [...pool].sort((a, b) => {
        if (a.rotationCycleCount !== b.rotationCycleCount) {
          return a.rotationCycleCount - b.rotationCycleCount;
        }
        const aTime = a.rotationSuspendedAt?.getTime() ?? 0;
        const bTime = b.rotationSuspendedAt?.getTime() ?? 0;
        return aTime - bTime;
      });

      const toSuspend = sorted.slice(0, excessCount);
      const cycleNum  = grandCycleByType[vehicleType] ?? 1;

      for (const v of toSuspend) {
        v.status              = VehicleStatus.SUSPENDED;
        v.suspendedByRotation = true;
        v.rejectionReason     = `Fuera de parqueadero por rotación — Ciclo ${cycleNum}`;
        v.rotationSuspendedAt = now;
        v.rotationCycleCount += 1;
      }

      vehiclesToSave.push(...currentlyRotated, ...toSuspend);
      this.logger.log(
        `[${vehicleType}] Rotación: ${currentlyRotated.length} reactivados, ${toSuspend.length} suspendidos`,
      );
    }

    // Guardar todos los vehículos modificados en una sola operación
    if (vehiclesToSave.length > 0) {
      await this.vehicleRepo.save(vehiclesToSave);
    }

    config.lastExecutedAt  = now;
    config.nextExecutionAt = this.calcNextExecution(now, config.rotationIntervalValue, config.rotationIntervalUnit);
    config.grandCycleByType = grandCycleByType;
    await this.rotationConfigRepo.save(config);

    return this.getRotationStatus(complexId, currentUser);
  }

  // ================================================================
  // ESTADO DE LA ROTACIÓN
  // ================================================================

  async getRotationStatus(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<RotationStatusResponse> {
    await this.complexService.findById(complexId, currentUser);

    const config = await this.rotationConfigRepo.findOne({
      where: { complexId },
      relations: ['createdByUser', 'updatedByUser'],
    });

    if (!config) {
      return { isConfigured: false, byType: [] };
    }

    const byType: RotationTypeStatus[] = [];

    for (const [vehicleType, availableSlots] of Object.entries(config.slotsByType)) {
      const pool = await this.vehicleRepo.find({
        where: [
          {
            complexId,
            type:      vehicleType as VehicleType,
            status:    VehicleStatus.ACTIVE,
            deletedAt: IsNull(),
          },
          {
            complexId,
            type:              vehicleType as VehicleType,
            status:            VehicleStatus.SUSPENDED,
            suspendedByRotation: true,
            deletedAt:         IsNull(),
          },
        ],
        relations: ['resident', 'resident.user', 'unit', 'unit.building'],
        order:     { rotationCycleCount: 'ASC', rotationSuspendedAt: 'ASC' },
      });

      const active             = pool.filter(v => v.status === VehicleStatus.ACTIVE);
      const suspendedByRotation = pool.filter(v => v.suspendedByRotation);
      const excessVehicles     = Math.max(0, pool.length - availableSlots);
      const grandCycleNumber   = config.grandCycleByType[vehicleType] ?? 1;

      // Candidatos a salir en la próxima rotación (entre los activos, los de menor prioridad)
      const nextCandidates = [...active]
        .sort((a, b) => {
          if (a.rotationCycleCount !== b.rotationCycleCount) {
            return a.rotationCycleCount - b.rotationCycleCount;
          }
          const aTime = a.rotationSuspendedAt?.getTime() ?? 0;
          const bTime = b.rotationSuspendedAt?.getTime() ?? 0;
          return aTime - bTime;
        })
        .slice(0, excessVehicles);

      byType.push({
        vehicleType,
        availableSlots,
        totalVehicles:             pool.length,
        activeVehicles:            active.length,
        suspendedByRotationCount:  suspendedByRotation.length,
        excessVehicles,
        grandCycleNumber,
        vehiclesSuspendedByRotation: suspendedByRotation,
        nextRotationCandidates:    nextCandidates,
      });
    }

    return { config, isConfigured: true, byType };
  }

  // ================================================================
  // HELPER — verificar cupos de parqueadero de la unidad
  // ================================================================

  private async assertParkingAvailable(unitId: string, complexId: string): Promise<void> {
    // Obtener la unidad con sus parkingSpots
    const unitResult = await this.vehicleRepo.manager
      .createQueryBuilder()
      .select(['u.parkingSpots as "parkingSpots"'])
      .from('units', 'u')
      .where('u.id = :unitId', { unitId })
      .getRawOne<{ parkingSpot: number }>();

    if (!unitResult) return; // Si no hay unidad, dejamos que falle en la validación de relación

    const maxSpots = unitResult.parkingSpot ?? 0;

    // Contar vehículos activos que ocupan parqueadero en esta unidad
    const activeVehicles = await this.vehicleRepo.count({
      where: {
        unitId,
        complexId,
        status:    In([VehicleStatus.ACTIVE, VehicleStatus.PENDING_APPROVAL]),
        type:      Not(In([VehicleType.BICYCLE, VehicleType.ELECTRIC_SCOOTER])),
        deletedAt: IsNull(),
      },
    });

    if (activeVehicles >= maxSpots && maxSpots > 0) {
      throw new CustomError({
        message: `La unidad ya tiene ${activeVehicles}/${maxSpots} vehículos registrados. No hay cupos de parqueadero disponibles.`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: LogisticsErrorCode.PARKING_SPOT_NOT_AVAILABLE,
      });
    }
  }

  // ================================================================
  // HELPER — cargar relaciones completas
  // ================================================================

  private async loadRelations(id: string): Promise<Vehicle> {
    return this.vehicleRepo.findOne({
      where:     { id },
      relations: ['resident', 'resident.user', 'unit', 'unit.building', 'approvedByUser'],
    });
  }

  // ================================================================
  // HELPER — calcular próxima ejecución de rotación
  // ================================================================

  private calcNextExecution(
    from: Date,
    value: number,
    unit: RotationIntervalUnit,
  ): Date {
    const next = new Date(from);
    switch (unit) {
      case RotationIntervalUnit.DAYS:
        next.setDate(next.getDate() + value);
        break;
      case RotationIntervalUnit.WEEKS:
        next.setDate(next.getDate() + value * 7);
        break;
      case RotationIntervalUnit.MONTHS:
        next.setMonth(next.getMonth() + value);
        break;
    }
    return next;
  }
}
