import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';

import { ChargeCategory } from '../entities/charge-category.entity';
import { ComplexFinanceConfig } from '../entities/complex-finance-config.entity';
import { FeeConfig } from '../entities/fee-config.entity';
import { FeeCharge } from '../entities/fee-charge.entity';
import { Payment } from '../entities/payment.entity';
import { WalletEntry } from '../entities/wallet-entry.entity';
import { UpsertComplexFinanceConfigInput } from '../dto/inputs/upsert-complex-finance-config.input';
import { ChargeStatus } from '../enums/charge-status.enum';
import { ChargeType } from '../enums/charge-type.enum';
import { FeeFrequency } from '../enums/fee-frequency.enum';
import { CreateChargeCategoryInput } from '../dto/inputs/create-charge-category.input';
import { UpdateChargeCategoryInput } from '../dto/inputs/update-charge-category.input';
import { CreateFeeConfigInput } from '../dto/inputs/create-fee-config.input';
import { UpdateFeeConfigInput } from '../dto/inputs/update-fee-config.input';
import { GenerateChargesInput } from '../dto/inputs/generate-charges.input';
import { RegisterPaymentInput } from '../dto/inputs/register-payment.input';
import { FilterChargesInput } from '../dto/inputs/filter-charges.input';
import { CreateDirectChargesInput } from '../dto/inputs/create-direct-charges.input';
import { CreateDirectChargesResponse } from '../dto/responses/create-direct-charges.response';
import { RegisterBulkPaymentInput } from '../dto/inputs/register-bulk-payment.input';
import { RegisterBulkPaymentResponse } from '../dto/responses/register-bulk-payment.response';
import { PaginatedChargesResponse } from '../dto/responses/paginated-charges.response';
import { GenerateChargesResponse } from '../dto/responses/generate-charges.response';
import { UnitBalanceResponse, ComplexFinancialSummaryResponse } from '../dto/responses/unit-balance.response';
import {
  CreateWalletCreditInput,
  ApplyWalletToChargeInput,
  ApplyMoraInput,
} from '../dto/inputs/wallet.input';
import {
  WalletEntryObject,
  UnitWalletResponse,
  WalletSummaryPaginated,
  ApplyWalletResult,
} from '../dto/responses/wallet.response';
import {
  UnitAccountStatementResponse,
  AccountMovement,
} from '../dto/responses/account-statement.response';
import {
  UnitFinancialStatusPaginated,
  MoraApplicationResult,
} from '../dto/responses/financial-status.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { FinanceErrorCode, ComplexErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { UnitType } from '../../residential-complex/enums/unit-type.enum';
import { UnitStatus } from '../../residential-complex/enums/unit-status.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { ResidentsService } from '../../residents/services/residents.service';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @InjectRepository(ChargeCategory)
    private readonly categoryRepo: Repository<ChargeCategory>,
    @InjectRepository(ComplexFinanceConfig)
    private readonly financeConfigRepo: Repository<ComplexFinanceConfig>,
    @InjectRepository(FeeConfig)
    private readonly feeConfigRepo: Repository<FeeConfig>,
    @InjectRepository(FeeCharge)
    private readonly chargeRepo: Repository<FeeCharge>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(WalletEntry)
    private readonly walletEntryRepo: Repository<WalletEntry>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) { }

  // ─────────────────────────────────────────────────────────────────────────────
  // CHARGE CATEGORIES
  // ─────────────────────────────────────────────────────────────────────────────

  async findCategoriesByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory[]> {
    await this.complexService.findById(complexId, currentUser);
    return this.categoryRepo.find({
      where: { complexId },
      order: { createdAt: 'ASC' },
    });
  }

  async createCategory(
    input: CreateChargeCategoryInput,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory> {
    await this.complexService.findById(input.complexId, currentUser);
    const category = this.categoryRepo.create({ ...input, isActive: true });
    return this.categoryRepo.save(category);
  }

  async updateCategory(
    input: UpdateChargeCategoryInput,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory> {
    const category = await this.findCategoryOrFail(input.id);
    await this.complexService.findById(category.complexId, currentUser);
    const { id, ...fields } = input;
    Object.assign(category, fields);
    return this.categoryRepo.save(category);
  }

  async deleteCategory(id: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const category = await this.findCategoryOrFail(id);
    await this.complexService.findById(category.complexId, currentUser);
    await this.categoryRepo.remove(category);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COMPLEX FINANCE CONFIG
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retorna la configuración financiera del complejo.
   * Si aún no existe, devuelve una instancia con los valores por defecto
   * sin persistirla (se crea al hacer upsert).
   */
  async getComplexFinanceConfig(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ComplexFinanceConfig> {
    await this.complexService.findById(complexId, currentUser);
    const existing = await this.financeConfigRepo.findOne({ where: { complexId } });
    if (existing) return existing;

    // Devolver defaults sin guardar
    const defaults = this.financeConfigRepo.create({
      complexId,
      moraRate: 2.0,
      moraGraceDays: 5,
      autoApplyMora: false,
      autoGenerateCharges: false,
    });
    return defaults;
  }

  async upsertComplexFinanceConfig(
    input: UpsertComplexFinanceConfigInput,
    currentUser: JwtAccessPayload,
  ): Promise<ComplexFinanceConfig> {
    await this.complexService.findById(input.complexId, currentUser);

    let config = await this.financeConfigRepo.findOne({ where: { complexId: input.complexId } });

    if (!config) {
      config = this.financeConfigRepo.create({
        complexId: input.complexId,
        moraRate: 2.0,
        moraGraceDays: 5,
        autoApplyMora: false,
        autoGenerateCharges: false,
      });
    }

    if (input.moraRate !== undefined) config.moraRate = input.moraRate;
    if (input.moraGraceDays !== undefined) config.moraGraceDays = input.moraGraceDays;
    if (input.autoApplyMora !== undefined) config.autoApplyMora = input.autoApplyMora;
    if (input.autoGenerateCharges !== undefined) config.autoGenerateCharges = input.autoGenerateCharges;

    return this.financeConfigRepo.save(config);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MÉTODOS INTERNOS PARA CRONS (sin validación de acceso)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Versión interna de generateCharges para uso desde cron jobs.
   * Omite la verificación de acceso del usuario.
   */
  async generateChargesInternal(
    complexId: string,
    period: string,
  ): Promise<{ generated: number; skipped: number; period: string }> {
    this.assertValidPeriod(period);

    const activeConfigs = await this.feeConfigRepo.find({
      where: { complexId, isActive: true, deletedAt: null as any },
    });

    const allUnits = await this.unitService.findAllByComplexInternal(complexId);

    let totalGenerated = 0;
    let totalSkipped = 0;

    for (const config of activeConfigs) {
      if (config.chargeType === ChargeType.LIMITED) {
        const paid = config.installmentsPaid ?? 0;
        const total = config.installments ?? 0;
        if (paid >= total) {
          config.isActive = false;
          await this.feeConfigRepo.save(config);
          continue;
        }
      }

      if (!this.shouldGenerateForPeriod(config, period)) {
        totalSkipped++;
        continue;
      }

      const targetUnits = await this.resolveTargetUnitsAdvanced(config, allUnits, complexId);
      let configGenerated = 0;

      for (const unit of targetUnits) {
        if (config.chargeType === ChargeType.ONCE) {
          const existingOnce = await this.chargeRepo.findOne({
            where: { feeConfigId: config.id, unitId: unit.id },
          });
          if (existingOnce) { totalSkipped++; continue; }
        } else {
          const existing = await this.chargeRepo.findOne({
            where: { feeConfigId: config.id, unitId: unit.id, period },
          });
          if (existing) { totalSkipped++; continue; }
        }

        const dueDate = this.buildDueDate(period, config.dueDayOfMonth);

        // Descuento de pronto pago: usar earlyPaymentAmount si la unidad está al día
        let chargeAmount: number = Number(config.amount);
        let normalAmount: number | null = null;

        if (config.earlyPaymentAmount != null) {
          const priorUnpaid = await this.chargeRepo
            .createQueryBuilder('c')
            .where('c.complexId = :complexId', { complexId })
            .andWhere('c.unitId = :unitId', { unitId: unit.id })
            .andWhere('c.period < :period', { period })
            .andWhere('c.status IN (:...statuses)', {
              statuses: [ChargeStatus.OVERDUE, ChargeStatus.PENDING, ChargeStatus.PARTIALLY_PAID],
            })
            .andWhere('c.deletedAt IS NULL')
            .getOne();

          if (!priorUnpaid) {
            chargeAmount = Number(config.earlyPaymentAmount);
            normalAmount = Number(config.amount);
          }
        }

        await this.chargeRepo.save(
          this.chargeRepo.create({
            complexId, unitId: unit.id, feeConfigId: config.id,
            period, dueDate, amount: chargeAmount, normalAmount, paidAmount: 0,
            description: `${config.name} — ${period}`,
            status: ChargeStatus.PENDING,
          }),
        );
        configGenerated++;
        totalGenerated++;
      }

      if (config.chargeType === ChargeType.LIMITED && configGenerated > 0) {
        config.installmentsPaid = (config.installmentsPaid ?? 0) + 1;
        if (config.installmentsPaid >= (config.installments ?? 0)) config.isActive = false;
        await this.feeConfigRepo.save(config);
      } else if (config.chargeType === ChargeType.ONCE && configGenerated > 0) {
        config.isActive = false;
        await this.feeConfigRepo.save(config);
      }
    }

    return { generated: totalGenerated, skipped: totalSkipped, period };
  }

  /**
   * Versión interna de applyMoraToPeriod para uso desde cron jobs.
   * Omite la verificación de acceso del usuario.
   */
  async applyMoraInternal(
    complexId: string,
    period: string,
    rate: number,
    graceDays: number,
  ): Promise<{ applied: number; skipped: number; totalMoraAmount: number }> {
    this.assertValidPeriod(period);

    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const overdueCharges = await this.chargeRepo.find({
      where: {
        complexId,
        status: In([ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID]),
        deletedAt: null as any,
      },
    });

    // Procesar solo cargos de períodos ANTERIORES al mes actual
    const chargesToProcess = overdueCharges.filter(c => c.period < currentPeriod);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let applied = 0;
    let totalMoraAmount = 0;
    let skipped = 0;

    try {
      for (const charge of chargesToProcess) {
        // Fecha de referencia: día 1 del mes siguiente al período del cargo
        const [chargeYear, chargeMonth] = charge.period.split('-').map(Number);
        const refDate = new Date(chargeYear, chargeMonth, 1); // chargeMonth es 1-indexed → mes siguiente en Date (0-indexed)
        const diasVencidos = Math.floor((now.getTime() - refDate.getTime()) / 86_400_000);

        if (diasVencidos <= graceDays) { skipped++; continue; }

        const diasEfectivos = diasVencidos - graceDays;
        const chargeBalance = Number(charge.amount) - Number(charge.paidAmount);
        const mora = Math.round(chargeBalance * (rate / 100) * (diasEfectivos / 30) * 100) / 100;

        if (mora <= 0) { skipped++; continue; }

        const moraDescription = `Interés mora — ${charge.description} (${charge.period})`;
        const existingMora = await queryRunner.manager.findOne(FeeCharge, {
          where: { complexId: charge.complexId, unitId: charge.unitId, period, description: moraDescription },
        });
        if (existingMora) { skipped++; continue; }

        const moraDueDate = new Date(now);
        moraDueDate.setDate(moraDueDate.getDate() + 5);

        await queryRunner.manager.save(
          FeeCharge,
          queryRunner.manager.create(FeeCharge, {
            complexId: charge.complexId, unitId: charge.unitId,
            period, dueDate: moraDueDate, amount: mora, paidAmount: 0,
            description: moraDescription, status: ChargeStatus.PENDING,
          }),
        );

        applied++;
        totalMoraAmount += mora;
      }

      await queryRunner.commitTransaction();
      return { applied, skipped, totalMoraAmount: Math.round(totalMoraAmount * 100) / 100 };

    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

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
      chargeType: input.chargeType ?? ChargeType.MONTHLY,
      installments: input.installments ?? null,
      installmentsPaid: 0,
      categoryId: input.categoryId ?? null,
      isActive: true,
      createdByUserId: currentUser.sub,
    });

    const savedConfig = await this.feeConfigRepo.save(config);

    void this.auditService.log({
      entityType: AuditEntityType.FeeConfig,
      entityId: savedConfig.id,
      action: AuditAction.CREATE,
      newValue: { id: savedConfig.id, name: savedConfig.name, amount: savedConfig.amount, complexId: input.complexId },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: input.complexId,
      description: `Configuración de cargo creada: "${savedConfig.name}" — $${savedConfig.amount}`,
    });

    return savedConfig;
  }

  async updateFeeConfig(
    input: UpdateFeeConfigInput,
    currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    const config = await this.findFeeConfigOrFail(input.id);
    await this.complexService.findById(config.complexId, currentUser);

    const { id, ...fields } = input;
    Object.assign(config, fields);

    return this.feeConfigRepo.save(config);
  }

  async deleteFeeConfig(
    configId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const config = await this.findFeeConfigOrFail(configId);
    await this.complexService.findById(config.complexId, currentUser);

    config.deletedAt = new Date();
    config.isActive = false;
    await this.feeConfigRepo.save(config);

    return true;
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
   * Genera cargos para TODAS las FeeConfigs activas del complejo en un período.
   *
   * Para cada config activa:
   * 1. Verifica si la frecuencia corresponde al período dado.
   * 2. Determina las unidades elegibles según el alcance de la config.
   * 3. Crea cargos idempotentes (omite si ya existe para unitId+feeConfigId+period).
   *
   * Soporta chargeType:
   *  - MONTHLY : recurrente indefinido
   *  - ONCE    : un solo cargo total (auto-desactiva la config)
   *  - LIMITED : cuotas contadas (auto-desactiva al completarse)
   */
  async generateCharges(
    input: GenerateChargesInput,
    currentUser: JwtAccessPayload,
  ): Promise<GenerateChargesResponse> {
    const { complexId, period } = input;
    await this.complexService.findById(complexId, currentUser);
    this.assertValidPeriod(period);

    const activeConfigs = await this.feeConfigRepo.find({
      where: { complexId, isActive: true, deletedAt: null as any },
    });

    const allUnits = await this.unitService.findAllByComplexInternal(complexId);

    let totalGenerated = 0;
    let totalSkipped = 0;

    for (const config of activeConfigs) {
      // Verificar cuotas para LIMITED antes de continuar
      if (config.chargeType === ChargeType.LIMITED) {
        const paid = config.installmentsPaid ?? 0;
        const total = config.installments ?? 0;
        if (paid >= total) {
          config.isActive = false;
          await this.feeConfigRepo.save(config);
          continue;
        }
      }

      // Verificar si la frecuencia aplica para este período
      if (!this.shouldGenerateForPeriod(config, period)) {
        totalSkipped++;
        continue;
      }

      const targetUnits = await this.resolveTargetUnitsAdvanced(config, allUnits, complexId);

      let configGenerated = 0;

      for (const unit of targetUnits) {
        if (config.chargeType === ChargeType.ONCE) {
          const existingOnce = await this.chargeRepo.findOne({
            where: { feeConfigId: config.id, unitId: unit.id },
          });
          if (existingOnce) {
            totalSkipped++;
            continue;
          }
        } else {
          const existing = await this.chargeRepo.findOne({
            where: { feeConfigId: config.id, unitId: unit.id, period },
          });
          if (existing) {
            totalSkipped++;
            continue;
          }
        }

        const dueDate = this.buildDueDate(period, config.dueDayOfMonth);

        // Descuento de pronto pago: usar earlyPaymentAmount si la unidad está al día
        let chargeAmount: number = Number(config.amount);
        let normalAmount: number | null = null;

        if (config.earlyPaymentAmount != null) {
          const priorUnpaid = await this.chargeRepo
            .createQueryBuilder('c')
            .where('c.complexId = :complexId', { complexId })
            .andWhere('c.unitId = :unitId', { unitId: unit.id })
            .andWhere('c.period < :period', { period })
            .andWhere('c.status IN (:...statuses)', {
              statuses: [ChargeStatus.OVERDUE, ChargeStatus.PENDING, ChargeStatus.PARTIALLY_PAID],
            })
            .andWhere('c.deletedAt IS NULL')
            .getOne();

          if (!priorUnpaid) {
            chargeAmount = Number(config.earlyPaymentAmount);
            normalAmount = Number(config.amount);
          }
        }

        await this.chargeRepo.save(
          this.chargeRepo.create({
            complexId,
            unitId: unit.id,
            feeConfigId: config.id,
            period,
            dueDate,
            amount: chargeAmount,
            normalAmount,
            paidAmount: 0,
            description: `${config.name} — ${period}`,
            status: ChargeStatus.PENDING,
          }),
        );
        configGenerated++;
        totalGenerated++;
      }

      // Actualizar config tras la generación
      if (config.chargeType === ChargeType.LIMITED && configGenerated > 0) {
        config.installmentsPaid = (config.installmentsPaid ?? 0) + 1;
        if (config.installmentsPaid >= (config.installments ?? 0)) {
          config.isActive = false;
        }
        await this.feeConfigRepo.save(config);
      } else if (config.chargeType === ChargeType.ONCE && configGenerated > 0) {
        config.isActive = false;
        await this.feeConfigRepo.save(config);
      }

      if (configGenerated > 0) {
        this.notifyChargeGenerated(complexId, config.name, Number(config.amount), period).catch(err =>
          this.logger.warn(`Error al notificar cargo generado (config ${config.id}): ${err?.message}`),
        );
      }
    }

    this.logger.log(
      `generateCharges — período ${period}, complejo ${complexId}: ` +
      `${totalGenerated} generados, ${totalSkipped} omitidos, ` +
      `${activeConfigs.length} configs procesadas.`,
    );

    if (totalGenerated > 0) {
      void this.auditService.log({
        entityType: AuditEntityType.FeeCharge,
        entityId: complexId,
        action: AuditAction.CREATE,
        newValue: { period, generated: totalGenerated, skipped: totalSkipped, complexId },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId,
        description: `Cargos generados: ${totalGenerated} para período ${period} — complejo ${complexId}`,
      });
    }

    return { generated: totalGenerated, skipped: totalSkipped, period };
  }

  /**
   * Crea cargos directos para múltiples unidades sin necesitar una FeeConfig.
   * Útil para cargos manuales (multas, cobros puntuales, etc.).
   *
   * Dedup: omite si ya existe un cargo con mismo complexId+unitId+period+description
   * donde feeConfigId IS NULL.
   */
  async createDirectCharges(
    input: CreateDirectChargesInput,
    currentUser: JwtAccessPayload,
  ): Promise<CreateDirectChargesResponse> {
    const { complexId, unitIds, description, amount, period } = input;
    await this.complexService.findById(complexId, currentUser);
    this.assertValidPeriod(period);

    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const dueDate = new Date(year, month - 1, lastDay);

    let created = 0;
    let skipped = 0;

    for (const unitId of unitIds) {
      const existing = await this.chargeRepo.findOne({
        where: { complexId, unitId, period, description, feeConfigId: IsNull() as any },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await this.chargeRepo.save(
        this.chargeRepo.create({
          complexId,
          unitId,
          period,
          dueDate,
          amount,
          paidAmount: 0,
          description,
          status: ChargeStatus.PENDING,
        }),
      );
      created++;

      this.notifyDirectChargeAdded(complexId, unitId, description, amount, period).catch(err =>
        this.logger.warn(`Error al notificar cargo directo en unidad ${unitId}: ${err?.message}`),
      );
    }

    this.logger.log(`createDirectCharges: ${created} creados, ${skipped} omitidos.`);

    if (created > 0) {
      void this.auditService.log({
        entityType: AuditEntityType.FeeCharge,
        entityId: complexId,
        action: AuditAction.CREATE,
        newValue: { period, created, skipped, description, amount, unitIds, complexId },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId,
        description: `Cargos directos creados: ${created} unidades — "${description}" $${amount} — período ${period}`,
      });
    }

    return { created, skipped };
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

    charge.status = ChargeStatus.WAIVED;
    charge.cancellationReason = reason;
    charge.cancelledByUserId = currentUser.sub;
    charge.cancelledAt = new Date();

    const savedWaive = await this.chargeRepo.save(charge);

    void this.auditService.log({
      entityType: AuditEntityType.FeeCharge,
      entityId: chargeId,
      action: AuditAction.UPDATE,
      previousValue: { status: charge.status },
      newValue: { status: ChargeStatus.WAIVED, reason, cancelledAt: charge.cancelledAt },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: charge.complexId,
      description: `Cargo exonerado: ${chargeId} — razón: ${reason}`,
    });

    return savedWaive;
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
    if (input.amount > balance + 0.01) {
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
      const payment = queryRunner.manager.create(Payment, {
        chargeId: charge.id,
        unitId: charge.unitId,
        complexId: charge.complexId,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        receiptUrl: input.receiptUrl,
        notes: input.notes,
        paidAt: new Date(input.paidAt),
        registeredByUserId: currentUser.entityType === 'user' ? currentUser.sub : null,
        isReversed: false,
      });
      const savedPayment = await queryRunner.manager.save(Payment, payment);

      const newPaid = Number(charge.paidAmount) + Number(input.amount);
      charge.paidAmount = newPaid;
      charge.status = newPaid >= Number(charge.amount) - 0.01
        ? ChargeStatus.PAID
        : ChargeStatus.PARTIALLY_PAID;

      await queryRunner.manager.save(FeeCharge, charge);
      await queryRunner.commitTransaction();

      void this.auditService.log({
        entityType: AuditEntityType.Payment,
        entityId: savedPayment.id,
        action: AuditAction.CREATE,
        newValue: { id: savedPayment.id, chargeId: input.chargeId, amount: input.amount, method: input.method, chargeStatus: charge.status },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: charge.complexId,
        description: `Pago registrado: $${input.amount} sobre cargo ${input.chargeId} — método: ${input.method}`,
      });

      this.notifyPaymentConfirmed(charge, input.amount, new Date(input.paidAt)).catch(err =>
        this.logger.warn(`Error al notificar pago ${savedPayment.id}: ${err?.message}`),
      );

      return savedPayment;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Distribuye el monto recibido entre los cargos PENDING/OVERDUE de la unidad,
   * aplicando FIFO (los más antiguos primero por dueDate ASC).
   * Si sobra saldo después de cubrir todos los cargos, se crea un WalletEntry CREDIT.
   */
  async registerBulkPayment(
    input: RegisterBulkPaymentInput,
    currentUser: JwtAccessPayload,
  ): Promise<RegisterBulkPaymentResponse> {
    const { unitId, complexId, amount, method, reference, notes, paidAt } = input;

    await this.complexService.findById(complexId, currentUser);

    const pendingCharges = await this.chargeRepo.find({
      where: {
        unitId,
        complexId,
        status: In([ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID]),
        deletedAt: null as any,
      },
      order: { dueDate: 'ASC' },
    });

    const paymentDate = new Date(paidAt);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let paid = 0;
    let created = 0;
    let remaining = amount;

    const paidNotifications: Array<{ charge: FeeCharge; paymentAmount: number; paymentDate: Date }> = [];

    try {
      for (const charge of pendingCharges) {
        if (remaining <= 0.001) break;

        const chargeBalance = Number(charge.amount) - Number(charge.paidAmount);
        const paymentAmount = Math.min(remaining, chargeBalance);

        await queryRunner.manager.save(
          Payment,
          queryRunner.manager.create(Payment, {
            chargeId: charge.id,
            unitId: charge.unitId,
            complexId: charge.complexId,
            amount: paymentAmount,
            method,
            reference,
            notes,
            paidAt: paymentDate,
            registeredByUserId: currentUser.entityType === 'user' ? currentUser.sub : null,
            isReversed: false,
          }),
        );
        created++;

        const newPaid = Number(charge.paidAmount) + paymentAmount;
        charge.paidAmount = newPaid;
        charge.status = newPaid >= Number(charge.amount) - 0.01
          ? ChargeStatus.PAID
          : ChargeStatus.PARTIALLY_PAID;

        if (charge.status === ChargeStatus.PAID) paid++;

        paidNotifications.push({ charge, paymentAmount, paymentDate });

        await queryRunner.manager.save(FeeCharge, charge);
        remaining = Math.round((remaining - paymentAmount) * 100) / 100;
      }

      // Saldo restante va al wallet como crédito
      if (remaining > 0.001) {
        await queryRunner.manager.save(
          WalletEntry,
          queryRunner.manager.create(WalletEntry, {
            type: 'CREDIT',
            amount: Math.round(remaining * 100) / 100,
            description: `Saldo a favor — pago masivo (${new Date(paidAt).toISOString().slice(0, 10)})`,
            unitId,
            complexId,
            chargeId: null,
          }),
        );
      }

      await queryRunner.commitTransaction();

      void this.auditService.log({
        entityType: AuditEntityType.Payment,
        entityId: complexId,
        action: AuditAction.CREATE,
        newValue: { unitId, complexId, amount, method, paid, created },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId,
        description: `Pago masivo FIFO: $${amount} — ${paid} cargos saldados, ${created} pagos creados`,
      });

      for (const { charge, paymentAmount, paymentDate } of paidNotifications) {
        this.notifyPaymentConfirmed(charge, paymentAmount, paymentDate).catch(err =>
          this.logger.warn(`Error al notificar pago bulk en cargo ${charge.id}: ${err?.message}`),
        );
      }

      return { paid, created };

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
      payment.isReversed = true;
      payment.reversalReason = reason;
      payment.reversedByUserId = currentUser.sub;
      payment.reversedAt = new Date();
      await queryRunner.manager.save(Payment, payment);

      const newPaid = Math.max(0, Number(charge.paidAmount) - Number(payment.amount));
      charge.paidAmount = newPaid;

      if (newPaid === 0) {
        const dueDate = charge.dueDate ? new Date(charge.dueDate) : null;
        charge.status = (dueDate && dueDate < new Date())
          ? ChargeStatus.OVERDUE
          : ChargeStatus.PENDING;
      } else {
        charge.status = ChargeStatus.PARTIALLY_PAID;
      }

      await queryRunner.manager.save(FeeCharge, charge);
      await queryRunner.commitTransaction();

      void this.auditService.log({
        entityType: AuditEntityType.Payment,
        entityId: paymentId,
        action: AuditAction.UPDATE,
        previousValue: { isReversed: false },
        newValue: { isReversed: true, reason, reversedAt: payment.reversedAt, newChargeStatus: charge.status },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: payment.complexId,
        description: `Pago anulado: ${paymentId} — razón: ${reason} — cargo: ${payment.chargeId}`,
      });

      return payment;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WALLET — SALDO A FAVOR
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Crea un crédito manual en el wallet de una unidad.
   */
  async createWalletCredit(
    input: CreateWalletCreditInput,
    currentUser: JwtAccessPayload,
  ): Promise<WalletEntryObject> {
    await this.complexService.findById(input.complexId, currentUser);

    const unit = await this.unitService.findById(input.unitId, currentUser);
    if (unit.complexId !== input.complexId) {
      throw new CustomError({
        message: 'La unidad no pertenece al complejo indicado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const entry = await this.walletEntryRepo.save(
      this.walletEntryRepo.create({
        type: 'CREDIT',
        amount: input.amount,
        description: input.description,
        unitId: input.unitId,
        complexId: input.complexId,
        chargeId: null,
      }),
    );

    return this.toWalletEntryObject(entry);
  }

  /**
   * Aplica saldo del wallet a un cargo específico.
   * Si `amount` es null, aplica todo el saldo disponible hasta cubrir el cargo.
   */
  async applyWalletToCharge(
    input: ApplyWalletToChargeInput,
    currentUser: JwtAccessPayload,
  ): Promise<ApplyWalletResult> {
    await this.complexService.findById(input.complexId, currentUser);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const walletBalance = await this.calcWalletBalance(input.unitId, input.complexId);

      if (walletBalance <= 0) {
        throw new CustomError({
          message: 'La unidad no tiene saldo en wallet',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: FinanceErrorCode.PAYMENT_EXCEEDS_BALANCE,
        });
      }

      if (input.amount !== undefined && input.amount !== null && input.amount > walletBalance + 0.01) {
        throw new CustomError({
          message: `El monto a aplicar (${input.amount}) supera el saldo disponible en wallet (${walletBalance.toFixed(2)})`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: FinanceErrorCode.PAYMENT_EXCEEDS_BALANCE,
        });
      }

      const charge = await queryRunner.manager.findOne(FeeCharge, {
        where: { id: input.chargeId, deletedAt: null as any },
      });

      if (!charge) {
        throw new CustomError({
          message: 'Cargo no encontrado',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: FinanceErrorCode.FEE_CHARGE_NOT_FOUND,
        });
      }

      if (charge.unitId !== input.unitId) {
        throw new CustomError({
          message: 'El cargo no pertenece a la unidad indicada',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
      }

      const eligibleStatuses = [ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID];
      if (!eligibleStatuses.includes(charge.status)) {
        throw new CustomError({
          message: `No se puede aplicar saldo a un cargo en estado ${charge.status}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: FinanceErrorCode.FEE_CHARGE_ALREADY_PAID,
        });
      }

      const chargeBalance = Number(charge.amount) - Number(charge.paidAmount);
      const requestedAmount = (input.amount !== undefined && input.amount !== null)
        ? input.amount
        : Infinity;
      const montoAplicado = Math.min(walletBalance, chargeBalance, requestedAmount);

      charge.paidAmount = Number(charge.paidAmount) + montoAplicado;
      const newBalance = Number(charge.amount) - charge.paidAmount;
      charge.status = newBalance <= 0.001
        ? ChargeStatus.PAID
        : ChargeStatus.PARTIALLY_PAID;

      await queryRunner.manager.save(FeeCharge, charge);

      await queryRunner.manager.save(
        WalletEntry,
        queryRunner.manager.create(WalletEntry, {
          type: 'DEBIT',
          amount: montoAplicado,
          description: `Aplicado a cargo: ${charge.description}`,
          unitId: input.unitId,
          complexId: input.complexId,
          chargeId: charge.id,
        }),
      );

      await queryRunner.commitTransaction();

      const remainingWalletBalance = walletBalance - montoAplicado;

      return {
        chargeId: charge.id,
        appliedAmount: Math.round(montoAplicado * 100) / 100,
        remainingWalletBalance: Math.round(remainingWalletBalance * 100) / 100,
        chargeStatus: charge.status,
      };

    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Calcula y registra mora sobre cargos vencidos del complejo.
   */
  async applyMoraToPeriod(
    input: ApplyMoraInput,
    currentUser: JwtAccessPayload,
  ): Promise<MoraApplicationResult> {
    await this.complexService.findById(input.complexId, currentUser);
    this.assertValidPeriod(input.period);

    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const overdueCharges = await this.chargeRepo.find({
      where: {
        complexId: input.complexId,
        status: In([ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID]),
        deletedAt: null as any,
      },
    });

    // Procesar solo cargos de períodos ANTERIORES al mes actual
    // El parámetro input.period se usa únicamente como etiqueta de los cargos de mora generados
    const chargesToProcess = overdueCharges.filter(c => c.period < currentPeriod);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let applied = 0;
    let totalMoraAmount = 0;
    let skipped = 0;

    try {
      for (const charge of chargesToProcess) {
        // Fecha de referencia: día 1 del mes siguiente al período del cargo
        const [chargeYear, chargeMonth] = charge.period.split('-').map(Number);
        const refDate = new Date(chargeYear, chargeMonth, 1); // chargeMonth es 1-indexed → mes siguiente en Date (0-indexed)
        const diasVencidos = Math.floor((now.getTime() - refDate.getTime()) / 86_400_000);

        if (diasVencidos <= input.graceDays) {
          skipped++;
          continue;
        }

        const diasEfectivos = diasVencidos - input.graceDays;
        const chargeBalance = Number(charge.amount) - Number(charge.paidAmount);
        const mora = Math.round(chargeBalance * (input.rate / 100) * (diasEfectivos / 30) * 100) / 100;

        if (mora <= 0) {
          skipped++;
          continue;
        }

        const moraDescription = `Interés mora — ${charge.description} (${charge.period})`;
        const existingMora = await queryRunner.manager.findOne(FeeCharge, {
          where: {
            complexId: charge.complexId,
            unitId: charge.unitId,
            period: input.period,
            description: moraDescription,
          },
        });

        if (existingMora) {
          skipped++;
          continue;
        }

        const moraDueDate = new Date(now);
        moraDueDate.setDate(moraDueDate.getDate() + 5);

        await queryRunner.manager.save(
          FeeCharge,
          queryRunner.manager.create(FeeCharge, {
            complexId: charge.complexId,
            unitId: charge.unitId,
            period: input.period,
            dueDate: moraDueDate,
            amount: mora,
            paidAmount: 0,
            description: moraDescription,
            status: ChargeStatus.PENDING,
          }),
        );

        applied++;
        totalMoraAmount += mora;
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `applyMoraToPeriod — período ${input.period}, complejo ${input.complexId}: ` +
        `${applied} cargos de mora creados, ${skipped} omitidos.`,
      );

      return {
        period: input.period,
        applied,
        totalMoraAmount: Math.round(totalMoraAmount * 100) / 100,
        skipped,
      };

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
      .leftJoinAndSelect('c.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .leftJoinAndSelect('c.feeConfig', 'feeConfig')
      .where('c.complexId = :complexId', { complexId })
      .andWhere('c.deletedAt IS NULL');

    if (filters.status) qb.andWhere('c.status = :status', { status: filters.status });
    if (filters.unitId) qb.andWhere('c.unitId = :unitId', { unitId: filters.unitId });
    if (filters.period) qb.andWhere('c.period = :period', { period: filters.period });
    if (filters.feeConfigId) qb.andWhere('c.feeConfigId = :feeConfigId', { feeConfigId: filters.feeConfigId });
    if (filters.unitSearch) {
      qb.andWhere(
        '(unit.number ILIKE :search OR building.name ILIKE :search)',
        { search: `%${filters.unitSearch}%` },
      );
    }

    qb.orderBy('c.dueDate', 'DESC');

    const totalItems = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
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

    const totalDebt = pendingCharges.reduce((sum, c) => sum + (Number(c.amount) - Number(c.paidAmount)), 0);
    const totalPaid = charges.reduce((sum, c) => sum + Number(c.paidAmount), 0);
    const overdueCount = charges.filter(c => c.status === ChargeStatus.OVERDUE).length;
    const pendingCount = charges.filter(c => c.status === ChargeStatus.PENDING).length;

    return {
      unitId,
      unitNumber: unit.number,
      totalDebt: Math.round(totalDebt * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
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

    const activeCharges = charges.filter(c => c.status !== ChargeStatus.CANCELLED && c.status !== ChargeStatus.WAIVED);
    const totalCharged = activeCharges.reduce((s, c) => s + Number(c.amount), 0);
    const totalCollected = activeCharges.reduce((s, c) => s + Number(c.paidAmount), 0);
    const totalOutstanding = totalCharged - totalCollected;

    const paidUnits = new Set(activeCharges.filter(c => c.status === ChargeStatus.PAID).map(c => c.unitId));
    const debtUnits = new Set(
      activeCharges
        .filter(c => [ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID].includes(c.status))
        .map(c => c.unitId),
    );

    return {
      complexId,
      period,
      totalCharged: Math.round(totalCharged * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      collectionRate: totalCharged > 0 ? Math.round((totalCollected / totalCharged) * 10000) / 100 : 0,
      unitsWithDebt: debtUnits.size,
      unitsFullyPaid: paidUnits.size,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WALLET QUERIES
  // ─────────────────────────────────────────────────────────────────────────────

  async getUnitWallet(
    unitId: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<UnitWalletResponse> {
    await this.complexService.findById(complexId, currentUser);

    const entries = await this.walletEntryRepo.find({
      where: { unitId, complexId },
      order: { createdAt: 'DESC' },
    });

    const totalCredits = entries.filter(e => e.type === 'CREDIT').reduce((s, e) => s + Number(e.amount), 0);
    const totalDebits = entries.filter(e => e.type === 'DEBIT').reduce((s, e) => s + Number(e.amount), 0);
    const currentBalance = totalCredits - totalDebits;

    const unitInfo = await this.getUnitWithBuilding(unitId);

    return {
      unitId,
      unitNumber: unitInfo.number,
      building: unitInfo.building ?? undefined,
      currentBalance: Math.round(currentBalance * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      totalDebits: Math.round(totalDebits * 100) / 100,
      entries: entries.map(e => this.toWalletEntryObject(e)),
    };
  }

  async getWalletsSummary(
    complexId: string,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<WalletSummaryPaginated> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;

    const walletAgg = await this.walletEntryRepo
      .createQueryBuilder('we')
      .select('we.unitId', 'unitId')
      .addSelect(`SUM(CASE WHEN we.type = 'CREDIT' THEN we.amount ELSE 0 END)`, 'totalCredits')
      .addSelect(`SUM(CASE WHEN we.type = 'DEBIT' THEN we.amount ELSE 0 END)`, 'totalDebits')
      .where('we.complexId = :complexId', { complexId })
      .groupBy('we.unitId')
      .getRawMany();

    if (!walletAgg.length) {
      return {
        items: [],
        pagination: {
          currentPage: page, itemsPerPage: limit, totalItems: 0,
          totalPages: 0, hasNextPage: false, hasPreviousPage: false,
        },
      };
    }

    const unitIds = walletAgg.map((r: any) => r.unitId);
    const units = await this.dataSource.getRepository(Unit).find({
      where: { id: In(unitIds) },
      relations: ['building'],
    });
    const unitMap = new Map(units.map(u => [u.id, u]));

    const allItems = walletAgg
      .map((r: any) => {
        const unit = unitMap.get(r.unitId);
        const totalCredits = Math.round(Number(r.totalCredits ?? 0) * 100) / 100;
        const totalDebits = Math.round(Number(r.totalDebits ?? 0) * 100) / 100;
        return {
          unitId: r.unitId,
          unitNumber: unit?.number ?? '',
          building: (unit as any)?.building?.name ?? undefined,
          currentBalance: Math.round((totalCredits - totalDebits) * 100) / 100,
          totalCredits,
          totalDebits,
        };
      })
      .sort((a, b) => b.currentBalance - a.currentBalance);

    const totalItems = allItems.length;
    const totalPages = Math.ceil(totalItems / limit);
    const sliced = allItems.slice((page - 1) * limit, page * limit);

    return {
      items: sliced,
      pagination: {
        currentPage: page, itemsPerPage: limit, totalItems, totalPages,
        hasNextPage: page < totalPages, hasPreviousPage: page > 1,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ESTADO DE CUENTA
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Genera el estado de cuenta completo de una unidad.
   * Si `period` se proporciona, filtra los movimientos a ese mes.
   */
  async getUnitAccountStatement(
    unitId: string,
    complexId: string,
    period: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<UnitAccountStatementResponse> {
    await this.complexService.findById(complexId, currentUser);

    let periodYear: number | null = null;
    let periodMonth: number | null = null;
    if (period) {
      this.assertValidPeriod(period);
      [periodYear, periodMonth] = period.split('-').map(Number);
    }

    const chargeQb = this.chargeRepo
      .createQueryBuilder('c')
      .where('c.unitId = :unitId', { unitId })
      .andWhere('c.complexId = :complexId', { complexId })
      .andWhere('c.deletedAt IS NULL');
    if (period) chargeQb.andWhere('c.period = :period', { period });
    const charges = await chargeQb.getMany();

    let payments: Payment[] = [];
    if (charges.length) {
      const chargeIds = charges.map(c => c.id);
      payments = await this.paymentRepo.find({
        where: { chargeId: In(chargeIds) },
        order: { paidAt: 'ASC' },
      });
    }

    let walletEntries = await this.walletEntryRepo.find({
      where: { unitId, complexId },
      order: { createdAt: 'ASC' },
    });
    if (period && periodYear !== null && periodMonth !== null) {
      walletEntries = walletEntries.filter(e => {
        const d = new Date(e.createdAt);
        return d.getFullYear() === periodYear && d.getMonth() + 1 === periodMonth;
      });
    }

    const movements: AccountMovement[] = [];

    for (const charge of charges) {
      movements.push({
        id: `charge-${charge.id}`,
        date: charge.createdAt.toISOString(),
        type: 'CHARGE',
        description: charge.description,
        debit: Number(charge.amount),
        credit: 0,
        balance: 0,
        reference: undefined,
      });
    }

    for (const p of payments) {
      const methodRef = p.reference ? ` — ${p.reference}` : '';
      movements.push({
        id: `payment-${p.id}`,
        date: p.paidAt.toISOString(),
        type: 'PAYMENT',
        description: `Pago — ${p.method}${methodRef}`,
        debit: 0,
        credit: Number(p.amount),
        balance: 0,
        reference: p.reference ?? undefined,
      });
    }

    for (const entry of walletEntries) {
      if (entry.type === 'CREDIT') {
        movements.push({
          id: `wallet-${entry.id}`,
          date: entry.createdAt.toISOString(),
          type: 'CREDIT',
          description: entry.description,
          debit: 0,
          credit: Number(entry.amount),
          balance: 0,
          reference: undefined,
        });
      } else if (entry.type === 'DEBIT') {
        movements.push({
          id: `wallet-${entry.id}`,
          date: entry.createdAt.toISOString(),
          type: 'DEBIT',
          description: 'Aplicación saldo a favor',
          debit: Number(entry.amount),
          credit: 0,
          balance: 0,
          reference: undefined,
        });
      }
    }

    movements.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    for (const mov of movements) {
      runningBalance += mov.debit - mov.credit;
      mov.balance = Math.round(runningBalance * 100) / 100;
    }

    const totalDebits = movements.reduce((s, m) => s + m.debit, 0);
    const totalCredits = movements.reduce((s, m) => s + m.credit, 0);

    const activeCharges = charges.filter(c =>
      [ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID].includes(c.status),
    );
    const currentBalance = activeCharges.reduce(
      (s, c) => s + (Number(c.amount) - Number(c.paidAmount)),
      0,
    );

    const allWalletEntries = await this.walletEntryRepo.find({ where: { unitId, complexId } });
    const walletBalance = this.calcWalletBalanceFromEntries(allWalletEntries);

    const unitInfo = await this.getUnitWithBuilding(unitId);

    return {
      unitId,
      unitNumber: unitInfo.number,
      building: unitInfo.building ?? undefined,
      totalDebits: Math.round(totalDebits * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      currentBalance: Math.round(currentBalance * 100) / 100,
      walletBalance: Math.round(walletBalance * 100) / 100,
      movements,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ESTADO FINANCIERO DE UNIDADES
  // ─────────────────────────────────────────────────────────────────────────────

  async getUnitsFinancialStatus(
    complexId: string,
    status: string | undefined,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<UnitFinancialStatusPaginated> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const statusOrder: Record<string, number> = { OVERDUE: 0, IN_DEBT: 1, UP_TO_DATE: 2, CREDIT: 3 };

    /**
     * Query única con LEFT JOINs desde `units`:
     *  - Garantiza que unidades sin cargos aparecen con totales en 0 → UP_TO_DATE
     *  - Excluye unidades DISABLED / MAINTENANCE
     */
    const allRows = await this.dataSource.getRepository(Unit)
      .createQueryBuilder('u')
      .select('u.id', 'unitId')
      .addSelect('u.number', 'unitNumber')
      .addSelect('b.name', 'building')
      .addSelect('COALESCE(ch.total_debt, 0)', 'totalDebt')
      .addSelect('COALESCE(ch.overdue_count, 0)', 'overdueCount')
      .addSelect('COALESCE(ch.pending_count, 0)', 'pendingCount')
      .addSelect('COALESCE(wl.wallet_balance, 0)', 'walletBalance')
      .leftJoin('u.building', 'b')
      // Subquery: agrega cargos pendientes/vencidos por unidad
      .leftJoin(
        qb => qb
          .select('c.unitId', 'unit_id')
          .addSelect(
            `SUM(CASE WHEN c.status IN ('${ChargeStatus.PENDING}','${ChargeStatus.OVERDUE}','${ChargeStatus.PARTIALLY_PAID}') THEN c.amount - c.paidAmount ELSE 0 END)`,
            'total_debt',
          )
          .addSelect(
            `SUM(CASE WHEN c.status = '${ChargeStatus.OVERDUE}' THEN 1 ELSE 0 END)`,
            'overdue_count',
          )
          .addSelect(
            `SUM(CASE WHEN c.status IN ('${ChargeStatus.PENDING}','${ChargeStatus.PARTIALLY_PAID}') THEN 1 ELSE 0 END)`,
            'pending_count',
          )
          .from(FeeCharge, 'c')
          .where('c.complexId = :complexId', { complexId })
          .andWhere('c.deletedAt IS NULL')
          .groupBy('c.unitId'),
        'ch',
        'ch.unit_id = u.id',
      )
      // Subquery: saldo de billetera por unidad
      .leftJoin(
        qb => qb
          .select('we.unitId', 'unit_id')
          .addSelect(
            `SUM(CASE WHEN we.type = 'CREDIT' THEN we.amount WHEN we.type = 'DEBIT' THEN -we.amount ELSE 0 END)`,
            'wallet_balance',
          )
          .from(WalletEntry, 'we')
          .where('we.complexId = :complexId', { complexId })
          .groupBy('we.unitId'),
        'wl',
        'wl.unit_id = u.id',
      )
      .where('u.complexId = :complexId', { complexId })
      .andWhere('u.deletedAt IS NULL')
      .andWhere('u.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [UnitStatus.DISABLED, UnitStatus.MAINTENANCE],
      })
      .orderBy('u.number', 'ASC')
      .getRawMany();

    // Derivar status financiero
    let items = allRows.map((row: any) => {
      const totalDebt = Math.round(Number(row.totalDebt) * 100) / 100;
      const overdueCount = Number(row.overdueCount);
      const pendingCount = Number(row.pendingCount);
      const walletBalance = Math.round(Number(row.walletBalance) * 100) / 100;

      let derivedStatus: string;
      if (overdueCount > 0) derivedStatus = 'OVERDUE';
      else if (totalDebt > 0) derivedStatus = 'IN_DEBT';
      else if (walletBalance > 0) derivedStatus = 'CREDIT';
      else derivedStatus = 'UP_TO_DATE';

      return {
        unitId: row.unitId,
        unitNumber: row.unitNumber,
        building: row.building ?? undefined,
        status: derivedStatus,
        totalDebt,
        walletBalance,
        overdueCount,
        pendingCount,
      };
    });

    if (status) items = items.filter(item => item.status === status);
    items.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4));

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / limit);
    const sliced = items.slice((page - 1) * limit, page * limit);

    return {
      items: sliced,
      pagination: {
        currentPage: page, itemsPerPage: limit, totalItems, totalPages,
        hasNextPage: page < totalPages, hasPreviousPage: page > 1,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ─────────────────────────────────────────────────────────────────────────────

  private async findCategoryOrFail(id: string): Promise<ChargeCategory> {
    const cat = await this.categoryRepo.findOne({ where: { id } });
    if (!cat) {
      throw new CustomError({
        message: 'Categoría de cargo no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }
    return cat;
  }

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

  /**
   * Determina si una FeeConfig debe generar cargos para el período dado,
   * según su frecuencia. La referencia de tiempo es la fecha de creación del config.
   */
  private shouldGenerateForPeriod(config: FeeConfig, period: string): boolean {
    const [periodYear, periodMonth] = period.split('-').map(Number);
    const createdAt = new Date(config.createdAt);
    const createdYear = createdAt.getFullYear();
    const createdMonth = createdAt.getMonth() + 1;

    switch (config.frequency) {
      case FeeFrequency.MONTHLY:
        return true;

      case FeeFrequency.BIMONTHLY:
        // Meses pares: Feb(2), Apr(4), Jun(6), Aug(8), Oct(10), Dec(12)
        return periodMonth % 2 === 0;

      case FeeFrequency.QUARTERLY: {
        const monthsDiff = (periodYear - createdYear) * 12 + (periodMonth - createdMonth);
        return monthsDiff >= 0 && monthsDiff % 3 === 0;
      }

      case FeeFrequency.SEMIANNUAL: {
        const monthsDiff = (periodYear - createdYear) * 12 + (periodMonth - createdMonth);
        return monthsDiff >= 0 && monthsDiff % 6 === 0;
      }

      case FeeFrequency.ANNUAL: {
        const monthsDiff = (periodYear - createdYear) * 12 + (periodMonth - createdMonth);
        return monthsDiff >= 0 && monthsDiff % 12 === 0;
      }

      case FeeFrequency.ONE_TIME:
        // Se delega al bloqueo de chargeType ONCE: siempre devuelve true aquí
        return true;

      default:
        return true;
    }
  }

  /**
   * Determina qué unidades aplican para una config:
   *  - unitId fijo          → solo esa unidad
   *  - unitType = VEHICLE_UNIT → unidades con al menos 1 vehículo activo
   *  - unitType específico  → unidades de ese tipo
   *  - sin ninguno          → todas las unidades del complejo
   */
  private async resolveTargetUnitsAdvanced(
    config: FeeConfig,
    allUnits: Unit[],
    complexId: string,
  ): Promise<Unit[]> {
    if (config.unitId) return allUnits.filter(u => u.id === config.unitId);

    if (!config.unitType) return allUnits;

    if (config.unitType === UnitType.VEHICLE_UNIT) {
      const vehicleRows = await this.vehicleRepo
        .createQueryBuilder('v')
        .select('DISTINCT v.unitId', 'unitId')
        .where('v.complexId = :complexId', { complexId })
        .andWhere("v.status = 'ACTIVE'")
        .andWhere('v.deleted_at IS NULL')
        .getRawMany();

      const activeUnitIds = new Set(vehicleRows.map((r: any) => r.unitId));
      return allUnits.filter(u => activeUnitIds.has(u.id));
    }

    return allUnits.filter(u => u.type === config.unitType);
  }

  /** Calcula la fecha de vencimiento a partir del período YYYY-MM y el día de vencimiento. */
  private buildDueDate(period: string, day: number): Date {
    const [year, month] = period.split('-').map(Number);
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

  /** Calcula el saldo actual del wallet para una unidad. */
  private async calcWalletBalance(unitId: string, complexId: string): Promise<number> {
    const entries = await this.walletEntryRepo.find({ where: { unitId, complexId } });
    return this.calcWalletBalanceFromEntries(entries);
  }

  private calcWalletBalanceFromEntries(entries: WalletEntry[]): number {
    const credits = entries.filter(e => e.type === 'CREDIT').reduce((s, e) => s + Number(e.amount), 0);
    const debits = entries.filter(e => e.type === 'DEBIT').reduce((s, e) => s + Number(e.amount), 0);
    return credits - debits;
  }

  /** Obtiene número y nombre de edificio de una unidad. */
  private async getUnitWithBuilding(unitId: string): Promise<{ number: string; building: string | null }> {
    const unit = await this.dataSource.getRepository(Unit).findOne({
      where: { id: unitId },
      relations: ['building'],
    });
    if (!unit) return { number: '', building: null };
    return { number: unit.number, building: (unit as any).building?.name ?? null };
  }

  private toWalletEntryObject(entry: WalletEntry): WalletEntryObject {
    return {
      id: entry.id,
      type: entry.type,
      amount: Number(entry.amount),
      description: entry.description,
      unitId: entry.unitId,
      chargeId: entry.chargeId ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  /** Notifica a los residentes activos de la unidad que se recibió el pago. */
  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS DE NOTIFICACIÓN (fire-and-forget)
  // ─────────────────────────────────────────────────────────────────────────────

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Bogota',
    });
  }

  /** Notifica a los residentes de una unidad que su pago fue confirmado. */
  private async notifyPaymentConfirmed(
    charge: FeeCharge,
    amount: number,
    paidAt: Date,
  ): Promise<void> {
    const residents = await this.residentsService.findActiveByUnitInternal(charge.unitId);
    const userIds = residents.map(r => r.userId).filter(Boolean) as string[];
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: charge.complexId,
      userIds,
      type: NotificationType.PAYMENT_CONFIRMED,
      priority: NotificationPriority.NORMAL,
      title: 'Pago confirmado',
      body: `Has realizado un pago por concepto de "${charge.description}" por un valor de ${this.formatCurrency(amount)} el día ${this.formatDate(paidAt)}.`,
    });
  }

  /** Notifica a todos los residentes del complejo que se generó un nuevo cargo masivo. */
  private async notifyChargeGenerated(
    complexId: string,
    configName: string,
    configAmount: number,
    period: string,
  ): Promise<void> {
    const userIds = await this.residentsService.findActiveUserIdsByComplexInternal(complexId);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId,
      userIds,
      type: NotificationType.CHARGE_ADDED,
      priority: NotificationPriority.NORMAL,
      title: 'Nuevo cargo generado',
      body: `Se ha generado un cargo por concepto de "${configName}" por un valor de ${this.formatCurrency(configAmount)} para el período ${period}.`,
    });
  }

  /** Notifica a los residentes de una unidad que se les agregó un cargo directo. */
  private async notifyDirectChargeAdded(
    complexId: string,
    unitId: string,
    description: string,
    amount: number,
    period: string,
  ): Promise<void> {
    const residents = await this.residentsService.findActiveByUnitInternal(unitId);
    const userIds = residents.map(r => r.userId).filter(Boolean) as string[];
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId,
      userIds,
      type:     NotificationType.DIRECT_CHARGE,
      priority: NotificationPriority.HIGH,
      title:    'Nuevo cargo aplicado a tu unidad',
      body:     `Se ha aplicado un cargo de $${amount.toLocaleString('es-CO')} por concepto: "${description}" para el período ${period}.`,
      metadata: { amount, description, period, unitId, complexId },
    });
  }
}
