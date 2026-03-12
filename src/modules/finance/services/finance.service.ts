import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';

import { FeeConfig }             from '../entities/fee-config.entity';
import { FeeCharge }             from '../entities/fee-charge.entity';
import { Payment }               from '../entities/payment.entity';
import { ChargeStatus }          from '../enums/charge-status.enum';
import { CreateFeeConfigInput }  from '../dto/inputs/create-fee-config.input';
import { GenerateChargesInput }  from '../dto/inputs/generate-charges.input';
import { RegisterPaymentInput }  from '../dto/inputs/register-payment.input';
import { FilterChargesInput }    from '../dto/inputs/filter-charges.input';
import { PaginatedChargesResponse }           from '../dto/responses/paginated-charges.response';
import { GenerateChargesResponse }            from '../dto/responses/generate-charges.response';
import { UnitBalanceResponse, ComplexFinancialSummaryResponse } from '../dto/responses/unit-balance.response';

import { PaginationInput }           from '../../shared/dto/inputs/pagination.input';
import { CustomError }               from '../../shared/utils/errors.utils';
import { FinanceErrorCode, ComplexErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }          from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService }               from '../../residential-complex/services/unit.service';
import { Unit }                      from '../../residential-complex/entities/unit.entity';
import { NotificationsService }      from '../../notifications/services/notifications.service';
import { NotificationType }          from '../../notifications/enums/notification-type.enum';
import { NotificationPriority }      from '../../notifications/enums/notification-priority.enum';
import { ResidentsService }          from '../../residents/services/residents.service';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @InjectRepository(FeeConfig)
    private readonly feeConfigRepo: Repository<FeeConfig>,
    @InjectRepository(FeeCharge)
    private readonly chargeRepo: Repository<FeeCharge>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // FEE CONFIGS
  // ─────────────────────────────────────────────────────────────────────────────

  async createFeeConfig(
    input: CreateFeeConfigInput,
    currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    await this.complexService.findById(input.complexId, currentUser);

    const config = this.feeConfigRepo.create({
      ...input,
      isActive: true,
      createdByUserId: currentUser.sub,
    });

    return this.feeConfigRepo.save(config);
  }

  async toggleFeeConfig(
    configId: string,
    currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    const config = await this.findFeeConfigOrFail(configId);
    await this.complexService.findById(config.complexId, currentUser);
    config.isActive = !config.isActive;
    return this.feeConfigRepo.save(config);
  }

  async findFeeConfigsByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<FeeConfig[]> {
    await this.complexService.findById(complexId, currentUser);
    return this.feeConfigRepo.find({
      where: { complexId, deletedAt: null as any },
      order: { createdAt: 'DESC' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERACIÓN DE CARGOS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Genera cargos (cuotas) para todas las unidades del complejo en un período.
   *
   * Lógica:
   *  1. Obtiene todas las configs activas (o solo la indicada)
   *  2. Por cada config, determina las unidades aplicables
   *  3. Inserta FeeCharge con `INSERT ... ON CONFLICT DO NOTHING` para idempotencia
   *
   * Retorna cuántos cargos se crearon vs cuántos ya existían (skip).
   */
  async generateCharges(
    input: GenerateChargesInput,
    currentUser: JwtAccessPayload,
  ): Promise<GenerateChargesResponse> {
    const { complexId, period, feeConfigId } = input;
    await this.complexService.findById(complexId, currentUser);

    this.assertValidPeriod(period);

    // Obtener configuraciones a procesar
    const configsWhere: any = { complexId, isActive: true, deletedAt: null };
    if (feeConfigId) configsWhere.id = feeConfigId;

    const configs = await this.feeConfigRepo.find({ where: configsWhere });
    if (!configs.length) {
      return { generated: 0, skipped: 0, period };
    }

    // Obtener todas las unidades activas del complejo
    const allUnits = await this.unitService.findAllByComplexInternal(complexId);

    let generated = 0;
    let skipped   = 0;

    for (const config of configs) {
      // Determinar unidades aplicables según el alcance de la config
      const targetUnits = this.resolveTargetUnits(config, allUnits);

      for (const unit of targetUnits) {
        const dueDate = this.buildDueDate(period, config.dueDayOfMonth);

        // Intentar insertar; si ya existe, ignorar (ON CONFLICT DO NOTHING via upsert)
        const existing = await this.chargeRepo.findOne({
          where: { complexId, unitId: unit.id, feeConfigId: config.id, period },
        });

        if (existing) {
          skipped++;
          continue;
        }

        await this.chargeRepo.save(
          this.chargeRepo.create({
            complexId,
            unitId:      unit.id,
            feeConfigId: config.id,
            period,
            dueDate,
            amount:      config.amount,
            paidAmount:  0,
            description: `${config.name} — ${period}`,
            status:      ChargeStatus.PENDING,
          }),
        );
        generated++;
      }
    }

    this.logger.log(
      `Período ${period} en complejo ${complexId}: ${generated} cargos generados, ${skipped} omitidos.`,
    );

    return { generated, skipped, period };
  }

  /**
   * Marca como OVERDUE todos los cargos PENDING/PARTIALLY_PAID cuya fecha
   * de vencimiento ya pasó. Pensado para correr vía cron diario.
   */
  async markOverdueCharges(complexId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await this.chargeRepo
      .createQueryBuilder()
      .update(FeeCharge)
      .set({ status: ChargeStatus.OVERDUE })
      .where('complexId = :complexId', { complexId })
      .andWhere('status IN (:...statuses)', {
        statuses: [ChargeStatus.PENDING, ChargeStatus.PARTIALLY_PAID],
      })
      .andWhere('dueDate < :today', { today })
      .andWhere('deletedAt IS NULL')
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Exonera / cancela un cargo. El monto no se cobra.
   */
  async waiveCharge(
    chargeId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<FeeCharge> {
    const charge = await this.findChargeOrFail(chargeId);
    await this.complexService.findById(charge.complexId, currentUser);

    if (charge.status === ChargeStatus.PAID) {
      throw new CustomError({
        message: 'No se puede exonerar un cargo ya pagado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.FEE_CHARGE_ALREADY_PAID,
      });
    }

    if ([ChargeStatus.CANCELLED, ChargeStatus.WAIVED].includes(charge.status)) {
      throw new CustomError({
        message: `El cargo ya está en estado ${charge.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.FEE_CHARGE_CANCELLED,
      });
    }

    charge.status            = ChargeStatus.WAIVED;
    charge.cancellationReason = reason;
    charge.cancelledByUserId  = currentUser.sub;
    charge.cancelledAt        = new Date();

    return this.chargeRepo.save(charge);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PAGOS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Registra un pago contra un cargo.
   * Actualiza `paidAmount` en el cargo y actualiza su estado en una transacción atómica.
   */
  async registerPayment(
    input: RegisterPaymentInput,
    currentUser: JwtAccessPayload,
  ): Promise<Payment> {
    const charge = await this.findChargeOrFail(input.chargeId);
    await this.complexService.findById(charge.complexId, currentUser);

    if ([ChargeStatus.CANCELLED, ChargeStatus.WAIVED].includes(charge.status)) {
      throw new CustomError({
        message: 'No se puede registrar un pago sobre un cargo cancelado o exonerado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.FEE_CHARGE_CANCELLED,
      });
    }

    if (charge.status === ChargeStatus.PAID) {
      throw new CustomError({
        message: 'El cargo ya está completamente pagado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.FEE_CHARGE_ALREADY_PAID,
      });
    }

    const balance = Number(charge.amount) - Number(charge.paidAmount);
    if (input.amount > balance + 0.01) {  // tolerancia de 1 centavo
      throw new CustomError({
        message: `El pago (${input.amount}) supera el saldo pendiente (${balance.toFixed(2)})`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.PAYMENT_EXCEEDS_BALANCE,
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Crear el pago
      const payment = queryRunner.manager.create(Payment, {
        chargeId:          charge.id,
        unitId:            charge.unitId,
        complexId:         charge.complexId,
        amount:            input.amount,
        method:            input.method,
        reference:         input.reference,
        receiptUrl:        input.receiptUrl,
        notes:             input.notes,
        paidAt:            new Date(input.paidAt),
        registeredByUserId: currentUser.sub,
        isReversed:        false,
      });
      const savedPayment = await queryRunner.manager.save(Payment, payment);

      // 2. Actualizar paidAmount y status del cargo
      const newPaid = Number(charge.paidAmount) + Number(input.amount);
      charge.paidAmount = newPaid;
      charge.status     = newPaid >= Number(charge.amount) - 0.01
        ? ChargeStatus.PAID
        : ChargeStatus.PARTIALLY_PAID;

      await queryRunner.manager.save(FeeCharge, charge);
      await queryRunner.commitTransaction();

      // 3. Notificar al residente (fire & forget)
      if (charge.status === ChargeStatus.PAID) {
        this.notifyPaymentReceived(charge).catch(err =>
          this.logger.warn(`Error al notificar pago ${savedPayment.id}: ${err?.message}`),
        );
      }

      return savedPayment;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Anula un pago registrado y descuenta el monto del `paidAmount` del cargo.
   */
  async reversePayment(
    paymentId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Payment> {
    const payment = await this.findPaymentOrFail(paymentId);
    await this.complexService.findById(payment.complexId, currentUser);

    if (payment.isReversed) {
      throw new CustomError({
        message: 'El pago ya fue anulado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.PAYMENT_ALREADY_REVERSED,
      });
    }

    const charge = await this.findChargeOrFail(payment.chargeId);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Marcar pago como anulado
      payment.isReversed       = true;
      payment.reversalReason   = reason;
      payment.reversedByUserId = currentUser.sub;
      payment.reversedAt       = new Date();
      await queryRunner.manager.save(Payment, payment);

      // 2. Recalcular paidAmount del cargo
      const newPaid = Math.max(0, Number(charge.paidAmount) - Number(payment.amount));
      charge.paidAmount = newPaid;

      // Recalcular estado según saldo
      if (newPaid === 0) {
        const dueDate = new Date(charge.dueDate);
        charge.status = dueDate < new Date() ? ChargeStatus.OVERDUE : ChargeStatus.PENDING;
      } else {
        charge.status = ChargeStatus.PARTIALLY_PAID;
      }

      await queryRunner.manager.save(FeeCharge, charge);
      await queryRunner.commitTransaction();

      return payment;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────────────────────

  async findChargesByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterChargesInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedChargesResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const qb = this.chargeRepo
      .createQueryBuilder('c')
      .where('c.complexId = :complexId', { complexId })
      .andWhere('c.deletedAt IS NULL');

    if (filters.status) qb.andWhere('c.status = :status', { status: filters.status });
    if (filters.unitId) qb.andWhere('c.unitId = :unitId', { unitId: filters.unitId });
    if (filters.period) qb.andWhere('c.period = :period', { period: filters.period });

    qb.orderBy('c.dueDate', 'DESC');

    const totalItems = await qb.getCount();
    const items      = await qb.skip((page - 1) * limit).take(limit).getMany();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page, itemsPerPage: limit, totalItems, totalPages,
        hasNextPage: page < totalPages, hasPreviousPage: page > 1,
      },
    };
  }

  async findPaymentsByCharge(
    chargeId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Payment[]> {
    const charge = await this.findChargeOrFail(chargeId);
    await this.complexService.findById(charge.complexId, currentUser);

    return this.paymentRepo.find({
      where: { chargeId },
      order: { paidAt: 'DESC' },
    });
  }

  async getUnitBalance(
    unitId: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<UnitBalanceResponse> {
    await this.complexService.findById(complexId, currentUser);
    const unit = await this.unitService.findById(unitId, currentUser);

    const charges = await this.chargeRepo.find({
      where: { unitId, complexId, deletedAt: null as any },
    });

    const pendingCharges = charges.filter(c =>
      [ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID].includes(c.status),
    );

    const totalDebt  = pendingCharges.reduce((sum, c) => sum + (Number(c.amount) - Number(c.paidAmount)), 0);
    const totalPaid  = charges.reduce((sum, c) => sum + Number(c.paidAmount), 0);
    const overdueCount  = charges.filter(c => c.status === ChargeStatus.OVERDUE).length;
    const pendingCount  = charges.filter(c => c.status === ChargeStatus.PENDING).length;

    return {
      unitId,
      unitNumber: unit.number,
      totalDebt:  Math.round(totalDebt * 100) / 100,
      totalPaid:  Math.round(totalPaid * 100) / 100,
      overdueCount,
      pendingCount,
    };
  }

  async getComplexFinancialSummary(
    complexId: string,
    period: string,
    currentUser: JwtAccessPayload,
  ): Promise<ComplexFinancialSummaryResponse> {
    await this.complexService.findById(complexId, currentUser);
    this.assertValidPeriod(period);

    const charges = await this.chargeRepo.find({
      where: { complexId, period, deletedAt: null as any },
    });

    const activeCharges  = charges.filter(c => c.status !== ChargeStatus.CANCELLED && c.status !== ChargeStatus.WAIVED);
    const totalCharged   = activeCharges.reduce((s, c) => s + Number(c.amount), 0);
    const totalCollected = activeCharges.reduce((s, c) => s + Number(c.paidAmount), 0);
    const totalOutstanding = totalCharged - totalCollected;

    const unitSet    = new Set(activeCharges.map(c => c.unitId));
    const paidUnits  = new Set(activeCharges.filter(c => c.status === ChargeStatus.PAID).map(c => c.unitId));
    const debtUnits  = new Set(
      activeCharges
        .filter(c => [ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID].includes(c.status))
        .map(c => c.unitId),
    );

    return {
      complexId,
      period,
      totalCharged:    Math.round(totalCharged * 100) / 100,
      totalCollected:  Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      collectionRate:  totalCharged > 0 ? Math.round((totalCollected / totalCharged) * 10000) / 100 : 0,
      unitsWithDebt:   debtUnits.size,
      unitsFullyPaid:  paidUnits.size,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ─────────────────────────────────────────────────────────────────────────────

  private async findFeeConfigOrFail(id: string): Promise<FeeConfig> {
    const config = await this.feeConfigRepo.findOne({ where: { id, deletedAt: null as any } });
    if (!config) {
      throw new CustomError({
        message: 'Configuración de cuota no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.FEE_CONFIG_NOT_FOUND,
      });
    }
    return config;
  }

  private async findChargeOrFail(id: string): Promise<FeeCharge> {
    const charge = await this.chargeRepo.findOne({ where: { id, deletedAt: null as any } });
    if (!charge) {
      throw new CustomError({
        message: 'Cargo no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.FEE_CHARGE_NOT_FOUND,
      });
    }
    return charge;
  }

  private async findPaymentOrFail(id: string): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { id } });
    if (!payment) {
      throw new CustomError({
        message: 'Pago no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.PAYMENT_NOT_FOUND,
      });
    }
    return payment;
  }

  /** Calcula la fecha de vencimiento a partir del período YYYY-MM y el día de vencimiento */
  private buildDueDate(period: string, day: number): Date {
    const [year, month] = period.split('-').map(Number);
    // Si el día supera el último día del mes, usar el último día
    const lastDay = new Date(year, month, 0).getDate();
    return new Date(year, month - 1, Math.min(day, lastDay));
  }

  private assertValidPeriod(period: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new CustomError({
        message: 'El período debe tener el formato YYYY-MM (ej. 2025-03)',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.PERIOD_INVALID_FORMAT,
      });
    }
  }

  /**
   * Determina qué unidades aplican para una config dada:
   * - Si tiene unitId     → solo esa unidad
   * - Si tiene unitType   → todas del mismo tipo
   * - Si no tiene ninguno → todas las unidades del complejo
   */
  private resolveTargetUnits(config: FeeConfig, allUnits: Unit[]): Unit[] {
    if (config.unitId)   return allUnits.filter(u => u.id === config.unitId);
    if (config.unitType) return allUnits.filter(u => u.type === config.unitType);
    return allUnits;
  }

  /** Notifica a los residentes activos de la unidad que se recibió el pago */
  private async notifyPaymentReceived(charge: FeeCharge): Promise<void> {
    const residents = await this.residentsService.findActiveByUnitInternal(charge.unitId);
    for (const resident of residents) {
      await this.notificationsService.create({
        type:            NotificationType.PAYMENT_RECEIVED,
        priority:        NotificationPriority.NORMAL,
        title:           '✅ Pago registrado',
        body:            `Tu pago de ${charge.description} ha sido registrado correctamente.`,
        complexId:       charge.complexId,
        recipientUserId: resident.userId,
        entityId:        charge.id,
        entityType:      'fee_charge',
        metadata:        { chargeId: charge.id, period: charge.period },
      });
    }
  }
}
