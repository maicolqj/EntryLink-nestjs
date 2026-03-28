import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Like, Repository } from 'typeorm';

import { ParkingConfig }           from '../entities/parking-config.entity';
import { ParkingRecord }           from '../entities/parking-record.entity';
import { ParkingRecordStatus }     from '../enums/parking-record-status.enum';
import { ParkingPaymentMethod }    from '../enums/parking-payment-method.enum';
import { ParkingRateType }         from '../enums/parking-rate-type.enum';
import { RegisterParkingEntryInput } from '../dto/inputs/register-parking-entry.input';
import { RegisterParkingExitInput }  from '../dto/inputs/register-parking-exit.input';
import { SaveParkingConfigInput }    from '../dto/inputs/save-parking-config.input';
import { FilterParkingRecordsInput } from '../dto/inputs/filter-parking-records.input';
import { ParkingRecordsResult }      from '../dto/responses/parking-records-result.response';

import { FeeCharge }    from '../../finance/entities/fee-charge.entity';
import { ChargeStatus } from '../../finance/enums/charge-status.enum';
import { CustomError }  from '../../shared/utils/errors.utils';
import { GeneralErrorCode, ParkingErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { AuditService }    from '../../audit/services/audit.service';
import { AuditAction }     from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';

@Injectable()
export class ParkingService {
  private readonly logger = new Logger(ParkingService.name);

  constructor(
    @InjectRepository(ParkingConfig)
    private readonly configRepo: Repository<ParkingConfig>,
    @InjectRepository(ParkingRecord)
    private readonly recordRepo: Repository<ParkingRecord>,
    @InjectRepository(FeeCharge)
    private readonly chargeRepo: Repository<FeeCharge>,
    private readonly auditService: AuditService,
  ) {}

  // ================================================================
  // REGISTRO DE ENTRADA
  // ================================================================

  async registerEntry(input: RegisterParkingEntryInput, currentUser?: JwtAccessPayload): Promise<ParkingRecord> {
    const invoiceNumber = await this.generateInvoiceNumber(input.complexId);

    const record = this.recordRepo.create({
      invoiceNumber,
      plate:       input.plate,
      vehicleType: input.vehicleType,
      brand:       input.brand,
      color:       input.color,
      unitId:      input.unitId,
      complexId:   input.complexId,
      status:      ParkingRecordStatus.OPEN,
    });

    const saved = await this.recordRepo.save(record);

    if (currentUser) {
      void this.auditService.log({
        entityType:      AuditEntityType.ParkingRecord,
        entityId:        saved.id,
        action:          AuditAction.CREATE,
        newValue:        { id: saved.id, invoiceNumber: saved.invoiceNumber, plate: saved.plate, vehicleType: saved.vehicleType, status: saved.status },
        performedById:   currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId:       input.complexId,
        description:     `Entrada de vehículo visitante [${input.plate}] — factura ${saved.invoiceNumber}`,
      });
    }

    return saved;
  }

  // ================================================================
  // REGISTRO DE SALIDA Y LIQUIDACIÓN
  // ================================================================

  async registerExit(input: RegisterParkingExitInput, currentUser?: JwtAccessPayload): Promise<ParkingRecord> {
    // 1. Obtener el registro OPEN
    const record = await this.recordRepo.findOne({
      where: { id: input.id, status: ParkingRecordStatus.OPEN },
    });

    if (!record) {
      // Verificar si existe pero con otro estado
      const exists = await this.recordRepo.findOne({ where: { id: input.id } });
      if (!exists) {
        throw new CustomError({
          message: `Registro de parqueadero con id '${input.id}' no encontrado.`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GeneralErrorCode.NOT_FOUND,
        });
      }
      throw new CustomError({
        message: `El registro de parqueadero ya fue cerrado (estado actual: ${exists.status}).`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.CONFLICT,
      });
    }

    // 2. Obtener configuración de tarifa del complejo
    const config = await this.configRepo.findOne({ where: { complexId: record.complexId } });
    if (!config) {
      throw new CustomError({
        message: `No existe configuración de parqueadero para el complejo. Configure la tarifa antes de liquidar.`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ParkingErrorCode.PARKING_RATE_NOT_FOUND,
      });
    }

    // 3. Calcular cobro
    const exitDate = new Date();
    const durationMinutes = Math.floor(
      (exitDate.getTime() - record.entryDate.getTime()) / 60_000,
    );
    const billable = Math.max(0, durationMinutes - (config.gracePeriodMinutes ?? 0));

    let total: number;
    switch (config.rateType) {
      case ParkingRateType.PER_MINUTE:
        total = billable * Number(config.rateAmount);
        break;
      case ParkingRateType.PER_HOUR:
        total = Math.ceil(billable / 60) * Number(config.rateAmount);
        break;
      case ParkingRateType.DAILY:
        total = Math.ceil(billable / 1440) * Number(config.rateAmount);
        break;
      case ParkingRateType.FIXED:
      case ParkingRateType.EVENT:
      default:
        total = Number(config.rateAmount);
    }

    if (config.maxDailyAmount && total > Number(config.maxDailyAmount)) {
      total = Number(config.maxDailyAmount);
    }
    total = Number(total.toFixed(2));

    // 4. Determinar estado según método de pago
    let newStatus: ParkingRecordStatus;

    if (input.paymentMethod === ParkingPaymentMethod.CHARGE_TO_UNIT) {
      if (!record.unitId) {
        throw new CustomError({
          message: `No se puede cargar a unidad: el registro de parqueadero no tiene una unidad asignada.`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
      }

      // Crear FeeCharge en la unidad
      const now    = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      await this.chargeRepo.save(
        this.chargeRepo.create({
          complexId:   record.complexId,
          unitId:      record.unitId,
          period,
          dueDate:     null,
          amount:      total,
          paidAmount:  0,
          description: `Parqueadero visitante — ${record.invoiceNumber}`,
          status:      ChargeStatus.PENDING,
          feeConfigId: undefined,
        }),
      );

      newStatus = ParkingRecordStatus.CHARGED_TO_UNIT;
    } else {
      newStatus = ParkingRecordStatus.PAID;
    }

    // 5. Persistir salida
    record.exitDate      = exitDate;
    record.duration      = durationMinutes;
    record.rate          = Number(config.rateAmount);
    record.total         = total;
    record.paymentMethod = input.paymentMethod;
    record.status        = newStatus;

    const saved = await this.recordRepo.save(record);

    if (currentUser) {
      void this.auditService.log({
        entityType:      AuditEntityType.ParkingRecord,
        entityId:        saved.id,
        action:          AuditAction.UPDATE,
        previousValue:   { status: ParkingRecordStatus.OPEN },
        newValue:        { status: newStatus, exitDate, duration: durationMinutes, total, paymentMethod: input.paymentMethod },
        performedById:   currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId:       saved.complexId,
        description:     `Salida de vehículo visitante [${saved.plate}] — ${durationMinutes} min — $${total} — ${input.paymentMethod}`,
      });
    }

    return saved;
  }

  // ================================================================
  // CANCELAR REGISTRO
  // ================================================================

  async cancelRecord(id: string, complexId?: string, currentUser?: JwtAccessPayload): Promise<ParkingRecord> {
    const record = await this.recordRepo.findOne({ where: { id } });

    if (!record) {
      throw new CustomError({
        message: `Registro de parqueadero con id '${id}' no encontrado.`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    if (complexId && record.complexId !== complexId) {
      throw new CustomError({
        message: 'No tiene permiso para cancelar registros de otro complejo.',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    if (record.status !== ParkingRecordStatus.OPEN) {
      throw new CustomError({
        message: `Solo se pueden cancelar registros OPEN. Estado actual: ${record.status}.`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.CONFLICT,
      });
    }

    record.status = ParkingRecordStatus.CANCELLED;
    const saved = await this.recordRepo.save(record);

    if (currentUser) {
      void this.auditService.log({
        entityType:      AuditEntityType.ParkingRecord,
        entityId:        id,
        action:          AuditAction.DELETE,
        previousValue:   { status: ParkingRecordStatus.OPEN },
        newValue:        { status: ParkingRecordStatus.CANCELLED },
        performedById:   currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId:       saved.complexId,
        description:     `Registro de parqueadero cancelado — placa: ${saved.plate} — factura: ${saved.invoiceNumber}`,
      });
    }

    return saved;
  }

  // ================================================================
  // LISTADO PAGINADO
  // ================================================================

  async findAll(filter: FilterParkingRecordsInput): Promise<ParkingRecordsResult> {
    const { complexId, status, plate, limit = 20, offset = 0 } = filter;

    const qb = this.recordRepo
      .createQueryBuilder('pr')
      .leftJoinAndSelect('pr.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .where('pr.complexId = :complexId', { complexId })
      .orderBy('pr.entryDate', 'DESC')
      .take(limit)
      .skip(offset);

    if (status) qb.andWhere('pr.status = :status', { status });
    if (plate)  qb.andWhere('pr.plate ILIKE :plate', { plate: `%${plate.toUpperCase()}%` });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, limit, offset };
  }

  // ================================================================
  // CONFIGURACIÓN DE TARIFA (UPSERT)
  // ================================================================

  async saveConfig(input: SaveParkingConfigInput): Promise<ParkingConfig> {
    const existing = await this.configRepo.findOne({ where: { complexId: input.complexId } });

    if (existing) {
      existing.rateType            = input.rateType;
      existing.rateAmount          = input.rateAmount;
      existing.gracePeriodMinutes  = input.gracePeriodMinutes ?? existing.gracePeriodMinutes;
      existing.maxDailyAmount      = input.maxDailyAmount ?? existing.maxDailyAmount;
      existing.currency            = input.currency ?? existing.currency;
      return this.configRepo.save(existing);
    }

    return this.configRepo.save(
      this.configRepo.create({
        complexId:           input.complexId,
        rateType:            input.rateType,
        rateAmount:          input.rateAmount,
        gracePeriodMinutes:  input.gracePeriodMinutes,
        maxDailyAmount:      input.maxDailyAmount,
        currency:            input.currency ?? 'COP',
      }),
    );
  }

  // ================================================================
  // OBTENER CONFIGURACIÓN
  // ================================================================

  async findConfig(complexId: string): Promise<ParkingConfig | null> {
    return this.configRepo.findOne({ where: { complexId } });
  }

  // ================================================================
  // GENERACIÓN DE NÚMERO DE FACTURA
  // ================================================================

  private async generateInvoiceNumber(complexId: string): Promise<string> {
    const now   = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix  = `PKG-${today}-`;

    // Contar cuántos registros de HOY ya existen en este complejo
    const count = await this.recordRepo
      .createQueryBuilder('pr')
      .where('pr.complex_id = :complexId', { complexId })
      .andWhere('pr.invoice_number LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();

    const sequence = String(count + 1).padStart(4, '0');
    return `${prefix}${sequence}`;
  }
}
