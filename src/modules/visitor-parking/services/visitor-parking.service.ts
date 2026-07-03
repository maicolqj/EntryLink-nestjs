import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, IsNull, Repository } from 'typeorm';

import { VisitorVehicle } from '../entities/visitor-vehicle.entity';
import { VisitorParkingConfig } from '../entities/visitor-parking-config.entity';
import { VisitorParkingRate } from '../entities/visitor-parking-rate.entity';
import { ParkingRecordStatus } from '../enums/parking-status.enum';

import { SetParkingRateInput } from '../dto/inputs/set-parking-rate.input';
import { RegisterVisitorVehicleInput } from '../dto/inputs/register-visitor-vehicle.input';
import { FilterVisitorVehiclesInput } from '../dto/inputs/filter-visitor-vehicles.input';
import { UpdateVisitorParkingConfigInput } from '../dto/inputs/update-visitor-parking-config.input';
import { PaginatedVisitorVehiclesResponse } from '../dto/responses/paginated-visitor-vehicles.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode, ParkingErrorCode, ResidentErrorCode } from '../../shared/constans/error-codes.constants';

import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { ParkingRecord } from '../../vehicles/entities/parking-record.entity';
import { ParkingRateType } from '../enums/parking-rate-type.enum';
import { ParkingPaymentMethod } from '../enums/parking-payment-method.enum';
import { ResgiterExitVehicle } from '../dto/inputs/register-exit-vehicle.input';
import { FeeCharge } from '../../finance/entities/fee-charge.entity';
import { ChargeStatus } from '../../finance/enums/charge-status.enum';
import { AccountingService } from '../../finance/services/accounting.service';

@Injectable()
export class VisitorParkingService {
  private readonly logger = new Logger(VisitorParkingService.name);

  constructor(

    @InjectRepository(VisitorVehicle)
    private readonly vehicleRepo: Repository<VisitorVehicle>,

    @InjectRepository(VisitorParkingConfig)
    private readonly configRepo: Repository<VisitorParkingConfig>,

    @InjectRepository(VisitorParkingRate)
    private readonly visitorRateRepo: Repository<VisitorParkingRate>,
  
  
    @InjectRepository(VisitorParkingRate)
    private readonly rateRepo: Repository<VisitorParkingRate>,

    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,

    @InjectRepository(ParkingRecord)
    private readonly recordRepo: Repository<ParkingRecord>,

    @InjectRepository(FeeCharge)
    private readonly chargeRepo: Repository<FeeCharge>,

    private readonly complexService: ResidentialComplexService,
    private readonly residentsService: ResidentsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly accountingService: AccountingService,
    private readonly dataSource: DataSource,

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
  ): Promise<VisitorParkingRate> {
    const { complexId, vehicleType, rateType } = input;
    this.logger.warn(`DATOS DE INGRESO ${JSON.stringify(input, null, 5)}`)
    await this.complexService.findById(input.complexId, currentUser);

    let rate = await this.rateRepo.findOne({
      where: { complexId, vehicleType, type: rateType },
    });

    if (rate) {
      rate.type = input.rateType;
      rate.isActive = input.isActive ?? rate.isActive;
      rate.description = input.description ?? rate.description;
    } else {
      // Crear nueva tarifa
      rate = this.rateRepo.create({
        complexId: input.complexId,
        vehicleType: input.vehicleType,
        type: input.rateType,
        isActive: input.isActive ?? true,
        description: input.description,
        createdByUser: currentUser,
      });
    }

    const saved = await this.rateRepo.save(rate);
    this.logger.log(
      `Tarifa [${input.vehicleType}] → $${input.rateType}/m en complejo ${input.complexId}`,
    );
    return saved;
  }

  /**
   * Retorna todas las tarifas configuradas en un complejo.
   */
  async getParkingRates(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingRate[]> {
    await this.complexService.findById(complexId, currentUser);

    return this.rateRepo.find({
      where: { complexId },
      order: { vehicleType: 'ASC' },
      relations: ['createdByUser'],
    });
  }


    // ================================================================
  // OBTENER CONFIGURACIÓN
  // ================================================================

  async findConfig(complexId: string): Promise<VisitorParkingConfig | null> {
    return this.configRepo.findOne({ where: { complexId } });
  }


    private async generateInvoiceNumber(complexId: string): Promise<string> {
    const now   = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix  = `PKG-${today}-`;

    // Contar cuántos registros de HOY ya existen en este complejo
    const count = await this.vehicleRepo
      .createQueryBuilder('vv')
      .where('vv.complex_id = :complexId', { complexId })
      .andWhere('vv.invoice_number LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();

    const sequence = String(count + 1).padStart(4, '0');
    return `${prefix}${sequence}`;
  }

  /**
   * Activa o desactiva una tarifa existente.
   */
  async toggleParkingRate(
    rateId: string,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingRate> {
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
    rate.updatedByUser.id = currentUser.sub;

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
    const complex = await this.complexService.findById(input.complexId, currentUser);
    // En sesiones de tipo 'complex' el sub del JWT es el id del complejo, no un user.
    // Para los FK hacia `users` usamos el owner del complejo (un user real).
    const actingUserId = currentUser.entityType === 'user' ? currentUser.sub : complex.ownerId;

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

    const invoiceNumber = await this.generateInvoiceNumber(input.complexId);

    const vehicle = this.vehicleRepo.create({
      plate: input.plate,
      vehicleType: input.vehicleType,
      driverName: input.driverName,
      entryDate: new Date(),
      status: ParkingRecordStatus.OPEN,
      hostResidentId: input.hostResidentId,
      complexId: input.complexId,
      notes: input.notes,
      // Solo asignar si quien registra es un usuario real.
      // Cuando entityType === 'complex', sub es el UUID del complejo (no existe en users)
      // y causaría una FK violation en registered_by_user_id.
      registeredByUserId: currentUser.entityType === 'user' ? currentUser.sub : null,
      invoiceNumber,
    });

    const saved = await this.vehicleRepo.save(vehicle);
    this.logger.log(
      `Ingreso vehículo [${input.plate}] al complejo ${input.complexId} — residente: ${input.hostResidentId}`,
    );

    void this.auditService.log({
      entityType: AuditEntityType.VisitorVehicle,
      entityId: saved.id,
      action: AuditAction.CREATE,
      newValue: { id: saved.id, plate: saved.plate, vehicleType: saved.vehicleType, status: saved.status, entryTime: saved.entryDate },
      performedById: actingUserId,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: input.complexId,
      description: `Ingreso de vehículo visitante [${input.plate}] — residente anfitrión: ${input.hostResidentId}`,
    });

    return this.loadRelations(saved.id);
  }


  async registerExit(
    input: ResgiterExitVehicle,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {

    const { paymentMethod, visitorVehicleId } = input;
    // 1. Obtener registro y validar
    const record = await this.vehicleRepo.findOne({
      where: { id: visitorVehicleId },
      relations: ['hostResident', 'hostResident.unit'],
    });

    if (!record || record.status !== ParkingRecordStatus.OPEN) {
      throw new CustomError({
        message: record ? `Registro ya cerrado.` : `Registro no encontrado.`,
        statusCode: record ? HttpStatus.CONFLICT : HttpStatus.NOT_FOUND,
      });
    }

    // Verifica acceso al complejo y resuelve el user que registra la salida.
    // En sesiones 'complex' el sub del JWT es el complejo → usamos su owner (user real).
    const complex = await this.complexService.findById(record.complexId, currentUser);
    const actingUserId = currentUser.entityType === 'user' ? currentUser.sub : complex.ownerId;

    // 2. Obtener la tarifa activa para este registro
    // Las tarifas se filtran por complexId (multi-tenant); configId es el id
    // autogenerado del VisitorParkingConfig, no el complexId.
    const activeRate = await this.rateRepo.findOne({
      where: {
        complexId: record.complexId,
        vehicleType: record.vehicleType,
        isActive: true,
      }
    });

    if (!activeRate) {
      throw new CustomError({
        message: 'No existe una tarifa activa configurada para este complejo.',
        statusCode: HttpStatus.NOT_FOUND,
      });
    }

    // 3. Cálculo de Tiempos
    const exitDate = new Date();
    const diffMs = exitDate.getTime() - record.entryDate.getTime();
    const exactMinutes = diffMs / 60_000;
    const durationMinutes = Math.ceil(exactMinutes); // Cobro por minuto iniciado

    let total = 0;
    // Usamos el periodo de gracia de la tarifa, o 0 si no tiene
    const graceMinutes = activeRate.gracePeriodMinutes ?? 0;

    // 4. Lógica de Cobro
    if (exactMinutes > graceMinutes) {
      const rateAmount = Number(activeRate.amount);

      // Calcular según el tipo de tarifa
      switch (activeRate.type) {
        case ParkingRateType.PER_MINUTE:
          total = durationMinutes * rateAmount;
          break;
        case ParkingRateType.PER_HOUR:
          total = Math.ceil(durationMinutes / 60) * rateAmount;
          break;
        case ParkingRateType.DAILY:
          total = Math.ceil(durationMinutes / 1440) * rateAmount;
          break;
        case ParkingRateType.FIXED:
        case ParkingRateType.EVENT:
        default:
          total = rateAmount;
      }

      // APLICAR TOPE MÁXIMO DIARIO
      if (activeRate.maxDailyAmount && total > Number(activeRate.maxDailyAmount)) {
        this.logger.debug(`Aplicando tope máximo: ${total} -> ${activeRate.maxDailyAmount}`);
        total = Number(activeRate.maxDailyAmount);
      }
    } else {
      total = 0; // Dentro del tiempo de gracia
    }

    total = Number(total.toFixed(2));

    const period = `${exitDate.getFullYear()}-${String(exitDate.getMonth() + 1).padStart(2, '0')}`;
    const chargeToUnit = input.paymentMethod === ParkingPaymentMethod.CHARGE_TO_UNIT;

    if (chargeToUnit && !record.hostResident?.unitId) {
      throw new CustomError({ message: 'Registro sin unidad asignada.', statusCode: 400 });
    }

    // 5-6. Registrar salida + reflejar el dinero en finanzas (mismo TX):
    //   - CASH/TRANSFER → recibo de caja (ingreso inmediato, cuenta 4220).
    //   - CHARGE_TO_UNIT → factura a la CxC de la unidad visitada (causa ingreso).
    const saved = await this.dataSource.transaction(async (em) => {
      let newStatus: ParkingRecordStatus = ParkingRecordStatus.PAID;

      if (chargeToUnit) {
        const dueDate = new Date(exitDate.getFullYear(), exitDate.getMonth() + 1, 0); // fin de mes
        if (total > 0) {
          await this.accountingService.emitVisitorParkingUnitCharge(em, {
            complexId: record.complexId,
            unitId: record.hostResident.unitId!,
            amount: total,
            period,
            dueDate,
            documentDate: exitDate,
            description: `Parqueadero: ${record.plate} (${durationMinutes} min)`,
            createdByUserId: actingUserId,
          });
        }
        newStatus = ParkingRecordStatus.CHARGED_TO_UNIT;
      } else if (total > 0) {
        await this.accountingService.emitVisitorParkingCashReceipt(em, {
          complexId: record.complexId,
          amount: total,
          isCash: input.paymentMethod === ParkingPaymentMethod.CASH,
          documentDate: exitDate,
          period,
          createdByUserId: actingUserId,
          memo: `Parqueadero visitante: ${record.plate} (${durationMinutes} min)`,
        });
      }

      record.exitDate = exitDate;
      record.duration = durationMinutes;
      record.parkingCost = total;
      record.paymentMethod = input.paymentMethod;
      record.status = newStatus;
      record.exitRegisteredByUserId = actingUserId;

      return em.save(VisitorVehicle, record);
    });

    this.logger.log(`Salida Exitosa: ${saved.plate} - Cobrado: $${total} (${durationMinutes} min)`);

    return saved;
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

    if (vehicle.status !== ParkingRecordStatus.OPEN) {
      throw new CustomError({
        message: `Solo se pueden cancelar registros con estado INSIDE. Estado actual: ${vehicle.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ParkingErrorCode.PARKING_VEHICLE_NOT_INSIDE,
      });
    }

    const complex = await this.complexService.findById(vehicle.complexId, currentUser);
    const actingUserId = currentUser.entityType === 'user' ? currentUser.sub : complex.ownerId;

    vehicle.status = ParkingRecordStatus.CANCELLED;
    vehicle.cancellationReason = cancellationReason;
    // Solo asignar si quien cancela es un usuario real (ver registerEntry).
    vehicle.cancelledByUserId = currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.vehicleRepo.save(vehicle);

    void this.auditService.log({
      entityType: AuditEntityType.VisitorVehicle,
      entityId: visitorVehicleId,
      action: AuditAction.DELETE,
      previousValue: { status: ParkingRecordStatus.OPEN },
      newValue: { status: ParkingRecordStatus.CANCELLED, cancellationReason },
      performedById: actingUserId,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: vehicle.complexId,
      description: `Registro de parqueadero cancelado — placa: ${vehicle.plate} — razón: ${cancellationReason}`,
    });

    return saved;
  }

  // ================================================================
  // CONFIGURACIÓN DEL PARQUEADERO VISITANTE
  // ================================================================

  /**
   * Retorna la configuración del parqueadero visitante para un complejo.
   * Devuelve null si aún no se ha creado ninguna configuración.
   */
  async getVisitorParkingConfig(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingConfig | null> {
    await this.complexService.findById(complexId, currentUser);

    return this.configRepo.findOne({
      where: { complexId },
      relations: ['rates'],
      order: { rates: { createdAt: 'ASC' } } as any,
    });
  }

  /**
   * Crea o actualiza la configuración del parqueadero visitante.
   * Si ya existe una configuración para el complejo, la actualiza (upsert).
   * Las tarifas incluidas en el input se crean o actualizan según si tienen ID.
   */
  async updateVisitorParkingConfig(
    input: UpdateVisitorParkingConfigInput,
    currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingConfig> {
    await this.complexService.findById(input.complexId, currentUser);

    let config = await this.configRepo.findOne({
      where: { complexId: input.complexId },
    });

    if (!config) {
      config = this.configRepo.create({ complexId: input.complexId });
    }

    if (input.maxCapacity !== undefined) config.maxCapacity = input.maxCapacity;
    if (input.gracePeriodMinutes !== undefined) config.gracePeriodMinutes = input.gracePeriodMinutes;
    if (input.receiptMessage !== undefined) config.receiptMessage = input.receiptMessage;
    if (input.showLogoOnReceipt !== undefined) config.showLogoOnReceipt = input.showLogoOnReceipt;
    if (input.activeRateId !== undefined) config.activeRateId = input.activeRateId;
    if (input.currency !== undefined) config.currency = input.currency;

    const saved = await this.configRepo.save(config);

    if (input.rates?.length) {
      for (const rateInput of input.rates) {
        if (rateInput.id) {
          await this.visitorRateRepo.update(
            { id: rateInput.id, configId: saved.id },
            {
              name: rateInput.name,
              type: rateInput.type,
              amount: rateInput.amount,
              currency: rateInput.currency,
              description: rateInput.description,
              isActive: rateInput.isActive,
            },
          );
        } else {
          await this.visitorRateRepo.save(
            this.visitorRateRepo.create({ ...rateInput, configId: saved.id, complexId: input.complexId }),
          );
        }
      }
    }

    this.logger.log(`Configuración de parqueadero visitante actualizada — complejo: ${input.complexId}`);

    return this.configRepo.findOne({
      where: { complexId: input.complexId },
      relations: ['rates'],
      order: { rates: { createdAt: 'ASC' } } as any,
    });
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
      where: { complexId, status: ParkingRecordStatus.OPEN },
      relations: ['hostResident', 'hostResident.user', 'hostResident.unit', 'hostResident.unit.building', 'registeredByUser'],
      order: { entryDate: 'ASC' },
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
      .leftJoinAndSelect('resident.unit', 'residentUnit')
      .leftJoinAndSelect('residentUnit.building', 'residentBuilding')
      .leftJoinAndSelect('vv.registeredByUser', 'registeredBy')
      .leftJoinAndSelect('vv.exitRegisteredByUser', 'exitBy')
      .where('vv.complex_id = :complexId', { complexId: filters.complexId });

    if (filters.status) {
      qb.andWhere('vv.status = :status', { status: filters.status });
    }

    if (filters.vehicleType) {
      qb.andWhere('vv.vehicleType = :vehicleType', { vehicleType: filters.vehicleType });
    }

    if (filters.plate) {
      qb.andWhere('vv.plate ILIKE :plate', { plate: `%${filters.plate.toUpperCase()}%` });
    }

    if (filters.hostResidentId) {
      qb.andWhere('vv.hostResident_id = :hostResidentId', { hostResidentId: filters.hostResidentId });
    }

    if (filters.dateFrom) {
      qb.andWhere('vv.entryDate >= :dateFrom', { dateFrom: filters.dateFrom });
    }

    if (filters.dateTo) {
      qb.andWhere('vv.entryDate <= :dateTo', { dateTo: filters.dateTo });
    }

    qb.orderBy('vv.entryDate', 'DESC');

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
        'hostResident.unit.building',
        'complex',
        'registeredByUser',
        'exitRegisteredByUser',
      ],
    });
  }

  /**
   * Notifica al residente principal activo de la unidad visitada
   * cuando se genera un cargo de parqueadero.
   * Solo se llama cuando parkingCost > 0.
   */
  private async notifyResidentsOfCharge(vehicle: VisitorVehicle): Promise<void> {
    const unitId = vehicle.hostResident?.unitId;
    if (!unitId) return;

    const mainResidents = await this.residentRepo.find({
      where: {
        unitId,
        complexId: vehicle.complexId,
        status: ResidentStatus.ACTIVE,
        isMainResident: true,
      },
    });

    const userIds = mainResidents.map(r => r.userId);
    if (userIds.length === 0) return;

    const cost = Number(vehicle.parkingCost ?? 0);
    const totalFormatted = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(cost);

    const unitNumber = vehicle.hostResident?.unit?.number ?? unitId;

    await this.notificationsService.notify({
      complexId: vehicle.complexId,
      userIds,
      type: NotificationType.PARKING_ASSIGNED,
      priority: NotificationPriority.HIGH,
      title: 'Cargo de parqueadero a tu unidad',
      body: `Se generó un cargo de ${totalFormatted} por parqueadero visitante (${vehicle.plate}). Revisa tu estado de cuenta.`,
      entityId: vehicle.id,
      entityType: 'visitor_vehicle',
      metadata: {
        visitorVehicleId: vehicle.id,
        plate: vehicle.plate,
        total: cost,
        unitNumber,
        exitTime: vehicle.exitDate?.toISOString(),
      },
    });
  }
}
