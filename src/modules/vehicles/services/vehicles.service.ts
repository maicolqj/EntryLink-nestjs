import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { Vehicle }               from '../entities/vehicle.entity';
import { VehicleStatus }         from '../enums/vehicle-status.enum';
import { VehicleType }           from '../enums/vehicle-type.enum';
import { RegisterVehicleInput }  from '../dto/inputs/register-vehicle.input';
import { UpdateVehicleInput }    from '../dto/inputs/update-vehicle.input';
import { FilterVehiclesInput }   from '../dto/inputs/filter-vehicles.input';
import { ApproveVehicleInput }   from '../dto/inputs/approve-vehicle.input';
import { PaginatedVehiclesResponse } from '../dto/responses/paginated-vehicles.response';
import { PlateCheckResponse }    from '../dto/responses/plate-check.response';

import { PaginationInput }           from '../../shared/dto/inputs/pagination.input';
import { CustomError }               from '../../shared/utils/errors.utils';
import { GeneralErrorCode, LogisticsErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }          from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }                from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService }          from '../../residents/services/residents.service';
import { ResidentStatus }            from '../../residents/enums/resident-status.enum';

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
    private readonly complexService:  ResidentialComplexService,
    private readonly residentsService: ResidentsService,
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

    // 2. Verificar que el residente existe y está ACTIVO en el complejo
    const resident = await this.residentsService.findById(input.residentId, currentUser);

    if (resident.status !== ResidentStatus.ACTIVE) {
      throw new CustomError({
        message: 'Solo se pueden registrar vehículos para residentes activos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    if (resident.complexId !== input.complexId) {
      throw new CustomError({
        message: 'El residente no pertenece al complejo indicado',
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
      await this.assertParkingAvailable(resident.unitId, input.complexId);
    }

    // 5. Crear el vehículo en PENDING_APPROVAL
    const vehicle = this.vehicleRepo.create({
      ...input,
      plate,
      unitId: resident.unitId,
      status: VehicleStatus.PENDING_APPROVAL,
    });

    const saved = await this.vehicleRepo.save(vehicle);
    this.logger.log(
      `Vehículo registrado: ${saved.id} — placa ${plate} — residente ${input.residentId}`,
    );
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
    return this.vehicleRepo.save(vehicle);
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
    return this.vehicleRepo.save(vehicle);
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
    return this.vehicleRepo.save(vehicle);
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
        { id: vehicle.complexId, ownerId: vehicle.complex?.ownerId } as any,
        currentUser,
      );
    }

    return vehicle;
  }

  // ================================================================
  // HELPER — verificar cupos de parqueadero de la unidad
  // ================================================================

  private async assertParkingAvailable(unitId: string, complexId: string): Promise<void> {
    // Obtener la unidad con sus parkingSpots
    const unitResult = await this.vehicleRepo.manager
      .createQueryBuilder()
      .select(['u.parking_spots as "parkingSpots"'])
      .from('units', 'u')
      .where('u.id = :unitId', { unitId })
      .getRawOne<{ parkingSpots: number }>();

    if (!unitResult) return; // Si no hay unidad, dejamos que falle en la validación de relación

    const maxSpots = unitResult.parkingSpots ?? 0;

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
}
