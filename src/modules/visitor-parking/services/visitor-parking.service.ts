import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';

import { ParkingRate } from '../entities/parking-rate.entity';
import { VisitorVehicle } from '../entities/visitor-vehicle.entity';
import { ParkingStatus } from '../enums/parking-status.enum';

import { SetParkingRateInput } from '../dto/inputs/set-parking-rate.input';
import { RegisterVisitorVehicleInput } from '../dto/inputs/register-visitor-vehicle.input';
import { FilterVisitorVehiclesInput } from '../dto/inputs/filter-visitor-vehicles.input';
import { PaginatedVisitorVehiclesResponse } from '../dto/responses/paginated-visitor-vehicles.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode, ParkingErrorCode, ResidentErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';

@Injectable()
export class VisitorParkingService {
  private readonly logger = new Logger(VisitorParkingService.name);

  constructor(
    @InjectRepository(ParkingRate)
    private readonly rateRepo: Repository<ParkingRate>,

    @InjectRepository(VisitorVehicle)
    private readonly vehicleRepo: Repository<VisitorVehicle>,

    private readonly complexService: ResidentialComplexService,
    private readonly residentsService: ResidentsService,
  ) { }

  // ================================================================
  // GESTIÓN DE TARIFAS
  // ================================================================

  /**
   * Crea o actualiza la tarifa de parqueadero para un tipo de vehículo
   * en un complejo. Si ya existe una tarifa para ese tipo, la actualiza.
   */
  async setParkingRate(
    input: SetParkingRateInput,
    currentUser: JwtAccessPayload,
  ): Promise<ParkingRate> {

    this.logger.warn(`DATOS DE INGRESO ${JSON.stringify(input, null, 5)}`)
    await this.complexService.findById(input.complexId, currentUser);

    let rate = await this.rateRepo.findOne({
      where: { complexId: input.complexId, vehicleType: input.vehicleType },
    });

    if (rate) {
      // Actualizar tarifa existente
      rate.ratePerMinute = input.ratePerMinute;
      rate.isActive = input.isActive ?? rate.isActive;
      rate.description = input.description ?? rate.description;
      rate.updatedByUserId = currentUser.sub;
    } else {
      // Crear nueva tarifa
      rate = this.rateRepo.create({
        complexId: input.complexId,
        vehicleType: input.vehicleType,
        ratePerMinute: input.ratePerMinute,
        isActive: input.isActive ?? true,
        description: input.description,
        createdByUserId: currentUser.sub,
      });
    }

    const saved = await this.rateRepo.save(rate);
    this.logger.log(
      `Tarifa [${input.vehicleType}] → $${input.ratePerMinute}/m en complejo ${input.complexId}`,
    );
    return saved;
  }

  /**
   * Retorna todas las tarifas configuradas en un complejo.
   */
  async getParkingRates(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ParkingRate[]> {
    await this.complexService.findById(complexId, currentUser);

    return this.rateRepo.find({
      where: { complexId },
      order: { vehicleType: 'ASC' },
      relations: ['createdByUser'],
    });
  }

  /**
   * Activa o desactiva una tarifa existente.
   */
  async toggleParkingRate(
    rateId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ParkingRate> {
    const rate = await this.rateRepo.findOne({ where: { id: rateId } });

    if (!rate) {
      throw new CustomError({
        message: `Tarifa con ID "${rateId}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ParkingErrorCode.PARKING_RATE_NOT_FOUND,
      });
    }

    await this.complexService.findById(rate.complexId, currentUser);

    rate.isActive = !rate.isActive;
    rate.updatedByUserId = currentUser.sub;

    return this.rateRepo.save(rate);
  }

  // ================================================================
  // REGISTRO DE VEHÍCULOS VISITANTES
  // ================================================================

  /**
   * Registra el ingreso de un vehículo visitante al parqueadero.
   * Valida que el residente anfitrión esté activo en el complejo.
   */
  async registerEntry(
    input: RegisterVisitorVehicleInput,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    await this.complexService.findById(input.complexId, currentUser);

    // Validar que el residente anfitrión existe y está activo
    const resident = await this.residentsService.findById(input.hostResidentId, currentUser);

    if (resident.status !== ResidentStatus.ACTIVE) {
      throw new CustomError({
        message: `El residente anfitrión no está activo. Estado actual: ${resident.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ResidentErrorCode.RESIDENT_NOT_FOUND,
      });
    }

    // Verificar que el complejo del residente coincide
    if (resident.complexId !== input.complexId) {
      throw new CustomError({
        message: 'El residente no pertenece al complejo especificado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    const vehicle = this.vehicleRepo.create({
      plate: input.plate,
      vehicleType: input.vehicleType,
      driverName: input.driverName,
      entryTime: new Date(),
      status: ParkingStatus.INSIDE,
      hostResidentId: input.hostResidentId,
      complexId: input.complexId,
      notes: input.notes,
      registeredByUserId: currentUser.sub,
    });

    const saved = await this.vehicleRepo.save(vehicle);
    this.logger.log(
      `Ingreso vehículo [${input.plate}] al complejo ${input.complexId} — residente: ${input.hostResidentId}`,
    );
    return this.loadRelations(saved.id);
  }

  /**
   * Registra la salida de un vehículo visitante y calcula el costo
   * del parqueo basado en el tiempo transcurrido y la tarifa vigente.
   *
   * Fórmula: ceil(minutos / 60) × tarifa_por_hora
   * (se cobra por hora completa, redondeando hacia arriba)
   */
  async registerExit(
    visitorVehicleId: string,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    const vehicle = await this.vehicleRepo.findOne({
      where: { id: visitorVehicleId },
    });

    if (!vehicle) {
      throw new CustomError({
        message: `Registro de parqueadero con ID "${visitorVehicleId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ParkingErrorCode.PARKING_RECORD_NOT_FOUND,
      });
    }

    if (vehicle.status !== ParkingStatus.INSIDE) {
      throw new CustomError({
        message: `El vehículo no está actualmente dentro del parqueadero. Estado: ${vehicle.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ParkingErrorCode.PARKING_VEHICLE_NOT_INSIDE,
      });
    }

    await this.complexService.findById(vehicle.complexId, currentUser);


    // Buscar tarifa activa para este tipo de vehículo en el complejo
    const rate = await this.rateRepo.findOne({
      where: {
        complexId: vehicle.complexId,
        vehicleType: vehicle.vehicleType,
        isActive: true,
      },
    });

    const rateApplied = rate ? Number(rate.ratePerMinute) : 0;

    const exitTime = new Date();
    const diffInMilliseconds = exitTime.getTime() - vehicle.entryTime.getTime();
    const exactMinutes = diffInMilliseconds / 60_000;

    const minutesToCharge = Math.max(1, Math.round(exactMinutes));

    const parkingCost = parseFloat((minutesToCharge * rateApplied).toFixed(2));

    vehicle.exitTime = exitTime;
    vehicle.minutesParked = minutesToCharge;
    vehicle.rateApplied = rateApplied;
    vehicle.parkingCost = parkingCost;
    vehicle.status = ParkingStatus.EXITED;
    vehicle.exitRegisteredByUserId = currentUser.sub;

    const saved = await this.vehicleRepo.save(vehicle);

    
    this.logger.log(
    `Salida vehículo [${vehicle.plate}] — ${exactMinutes.toFixed(2)} min reales → ` +
    `${minutesToCharge} min cobrados × $${rateApplied}/min = $${parkingCost}`,
  );
    return this.loadRelations(saved.id);
  }

  /**
   * Cancela un registro de parqueadero (error de captura, etc.).
   * Solo se puede cancelar si el vehículo está INSIDE.
   */
  async cancelEntry(
    visitorVehicleId: string,
    cancellationReason: string,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    const vehicle = await this.vehicleRepo.findOne({
      where: { id: visitorVehicleId },
    });

    if (!vehicle) {
      throw new CustomError({
        message: `Registro de parqueadero con ID "${visitorVehicleId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ParkingErrorCode.PARKING_RECORD_NOT_FOUND,
      });
    }

    if (vehicle.status !== ParkingStatus.INSIDE) {
      throw new CustomError({
        message: `Solo se pueden cancelar registros con estado INSIDE. Estado actual: ${vehicle.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ParkingErrorCode.PARKING_VEHICLE_NOT_INSIDE,
      });
    }

    await this.complexService.findById(vehicle.complexId, currentUser);

    vehicle.status = ParkingStatus.CANCELLED;
    vehicle.cancellationReason = cancellationReason;
    vehicle.cancelledByUserId = currentUser.sub;

    return this.vehicleRepo.save(vehicle);
  }

  // ================================================================
  // CONSULTAS
  // ================================================================

  /**
   * Lista todos los vehículos actualmente dentro del parqueadero.
   */
  async findActive(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle[]> {
    await this.complexService.findById(complexId, currentUser);

    return this.vehicleRepo.find({
      where: { complexId, status: ParkingStatus.INSIDE },
      relations: ['hostResident', 'hostResident.user', 'registeredByUser'],
      order: { entryTime: 'ASC' },
    });
  }

  /**
   * Historial paginado de vehículos visitantes con filtros opcionales.
   */
  async findAll(
    filters: FilterVisitorVehiclesInput,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedVisitorVehiclesResponse> {
    await this.complexService.findById(filters.complexId, currentUser);

    const qb = this.vehicleRepo
      .createQueryBuilder('vv')
      .leftJoinAndSelect('vv.hostResident', 'resident')
      .leftJoinAndSelect('resident.user', 'residentUser')
      .leftJoinAndSelect('vv.registeredByUser', 'registeredBy')
      .leftJoinAndSelect('vv.exitRegisteredByUser', 'exitBy')
      .where('vv.complex_id = :complexId', { complexId: filters.complexId });

    if (filters.status) {
      qb.andWhere('vv.status = :status', { status: filters.status });
    }

    if (filters.vehicleType) {
      qb.andWhere('vv.vehicle_type = :vehicleType', { vehicleType: filters.vehicleType });
    }

    if (filters.plate) {
      qb.andWhere('vv.plate ILIKE :plate', { plate: `%${filters.plate.toUpperCase()}%` });
    }

    if (filters.hostResidentId) {
      qb.andWhere('vv.host_resident_id = :hostResidentId', { hostResidentId: filters.hostResidentId });
    }

    if (filters.dateFrom) {
      qb.andWhere('vv.entry_time >= :dateFrom', { dateFrom: filters.dateFrom });
    }

    if (filters.dateTo) {
      qb.andWhere('vv.entry_time <= :dateTo', { dateTo: filters.dateTo });
    }

    qb.orderBy('vv.entry_time', 'DESC');

    const totalItems = await qb.getCount();
    const totalPages = Math.ceil(totalItems / pagination.limit);

    qb.skip((pagination.page - 1) * pagination.limit).take(pagination.limit);

    const items = await qb.getMany();

    return {
      items,
      pagination: {
        currentPage: pagination.page,
        itemsPerPage: pagination.limit,
        totalItems,
        totalPages,
        hasNextPage: pagination.page < totalPages,
        hasPreviousPage: pagination.page > 1,
      },
    };
  }

  /**
   * Obtiene un registro de vehículo visitante por su ID.
   */
  async findById(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    const vehicle = await this.loadRelations(id);

    if (!vehicle) {
      throw new CustomError({
        message: `Registro de parqueadero con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ParkingErrorCode.PARKING_RECORD_NOT_FOUND,
      });
    }

    await this.complexService.findById(vehicle.complexId, currentUser);
    return vehicle;
  }

  // ================================================================
  // PRIVADOS
  // ================================================================

  private async loadRelations(id: string): Promise<VisitorVehicle> {
    return this.vehicleRepo.findOne({
      where: { id },
      relations: [
        'hostResident',
        'hostResident.user',
        'hostResident.unit',
        'complex',
        'registeredByUser',
        'exitRegisteredByUser',
      ],
    });
  }
}
