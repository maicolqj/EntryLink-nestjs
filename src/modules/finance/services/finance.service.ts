import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';

import { ChargeCategory } from '../entities/charge-category.entity';
import { ComplexFinanceConfig } from '../entities/complex-finance-config.entity';
import { FeeConfig } from '../entities/fee-config.entity';
import { FeeCharge } from '../entities/fee-charge.entity';
import { Payment } from '../entities/payment.entity';
import { WalletEntry } from '../entities/wallet-entry.entity';
import { ComplexExpense } from '../entities/complex-expense.entity';
import { RecurringCharge } from '../entities/recurring-charge.entity';
import { UpsertComplexFinanceConfigInput } from '../dto/inputs/upsert-complex-finance-config.input';
import { ChargeStatus } from '../enums/charge-status.enum';
import { ChargeType } from '../enums/charge-type.enum';
import { PrelacionConcept } from '../enums/prelacion-concept.enum';
import { AccountingService } from './accounting.service';
import { FeeFrequency } from '../enums/fee-frequency.enum';
import { FeeConfigBillingMode } from '../enums/fee-config-billing-mode.enum';
import { FeeConfigTriggerType } from '../enums/fee-config-trigger-type.enum';
import { CreateChargeCategoryInput } from '../dto/inputs/create-charge-category.input';
import { UpdateChargeCategoryInput } from '../dto/inputs/update-charge-category.input';
import { CreateFeeConfigInput } from '../dto/inputs/create-fee-config.input';
import { UpdateFeeConfigInput } from '../dto/inputs/update-fee-config.input';
import { FeeConfigTargetRules } from '../dto/inputs/fee-config-target-rules.input';
import { GenerateChargesInput } from '../dto/inputs/generate-charges.input';
import { RegisterPaymentInput } from '../dto/inputs/register-payment.input';
import { FilterChargesInput } from '../dto/inputs/filter-charges.input';
import { CreateDirectChargesInput } from '../dto/inputs/create-direct-charges.input';
import { CreateDirectChargesResponse } from '../dto/responses/create-direct-charges.response';
import { RegisterExpenseInput } from '../dto/inputs/register-expense.input';
import { FilterExpensesInput } from '../dto/inputs/filter-expenses.input';
import { PaginatedExpensesResponse, ExpenseCategoryBreakdown } from '../dto/responses/paginated-expenses.response';
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
import { ExpenseCategory } from '../enums/expense-category.enum';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { UnitType } from '../../residential-complex/enums/unit-type.enum';
import { UnitStatus } from '../../residential-complex/enums/unit-status.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { WalletAppliedMetadata } from '../../notifications/interfaces/notification-metadata.interface';
import { ResidentsService } from '../../residents/services/residents.service';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';

/** Usuario de sistema para procesos automáticos (cron). Sin FK; solo trazabilidad. */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

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
    @InjectRepository(ComplexExpense)
    private readonly expenseRepo: Repository<ComplexExpense>,
    private readonly accountingService: AccountingService,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly socketService: SocketService,
    private readonly cacheService: CacheService,
  ) { }

  // ─────────────────────────────────────────────────────────────────────────────
  // CHARGE CATEGORIES
  // ─────────────────────────────────────────────────────────────────────────────

  async findCategoriesByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory[]> {
    await this.complexService.findById(complexId, currentUser);

    const cacheKey = BK.finance.categories(complexId);
    const cached = await this.cacheService.get<ChargeCategory[]>({ key: cacheKey });
    if (cached) return cached;

    const categories = await this.categoryRepo.find({
      where: { complexId },
      order: { createdAt: 'ASC' },
    });
    await this.cacheService.set({ key: cacheKey, data: categories, options: { ttl: BK.finance.TTL_CATS } });
    return categories;
  }

  async createCategory(
    input: CreateChargeCategoryInput,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory> {
    await this.complexService.findById(input.complexId, currentUser);
    const category = this.categoryRepo.create({ ...input, isActive: true });
    const saved = await this.categoryRepo.save(category);
    await this.cacheService.deleteByPrefix(BK.finance.prefix(input.complexId));
    return saved;
  }

  async updateCategory(
    input: UpdateChargeCategoryInput,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory> {
    const category = await this.findCategoryOrFail(input.id);
    await this.complexService.findById(category.complexId, currentUser);
    const { id, ...fields } = input;
    Object.assign(category, fields);
    const saved = await this.categoryRepo.save(category);
    await this.cacheService.deleteByPrefix(BK.finance.prefix(category.complexId));
    return saved;
  }

  async deleteCategory(id: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const category = await this.findCategoryOrFail(id);
    await this.complexService.findById(category.complexId, currentUser);
    await this.categoryRepo.remove(category);
    await this.cacheService.deleteByPrefix(BK.finance.prefix(category.complexId));
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

    const cacheKey = BK.finance.config(complexId);
    const cached = await this.cacheService.get<ComplexFinanceConfig>({ key: cacheKey });
    if (cached) return cached;

    const existing = await this.financeConfigRepo.findOne({ where: { complexId } });
    if (existing) {
      await this.cacheService.set({ key: cacheKey, data: existing, options: { ttl: BK.finance.TTL_CONFIG } });
      return existing;
    }

    // No existe config: crear una con valores por defecto y persistirla.
    // Así createdAt/updatedAt siempre traen valor real (los campos GraphQL son
    // DateTime! no-nullables) y la pantalla queda lista para editar vía upsert.
    const created = this.financeConfigRepo.create({
      complexId,
      moraRate: 2.0,
      moraGraceDays: 5,
      autoApplyMora: false,
      autoGenerateCharges: false,
    });
    const saved = await this.financeConfigRepo.save(created);

    await this.cacheService.set({ key: cacheKey, data: saved, options: { ttl: BK.finance.TTL_CONFIG } });
    return saved;
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
    if (input.earlyDiscountPct !== undefined) config.earlyDiscountPct = input.earlyDiscountPct;
    if (input.earlyDiscountDay !== undefined) config.earlyDiscountDay = input.earlyDiscountDay;

    const saved = await this.financeConfigRepo.save(config);
    await this.cacheService.deleteByPrefix(BK.finance.prefix(input.complexId));
    return saved;
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

    // Candado anti-doble-facturación: RecurringCharge es el mecanismo canónico.
    // Si un FeeConfig comparte concepto (name) con un recurrente activo, se omite
    // para no causar el mismo cobro por ambos caminos.
    const recurringConcepts = new Set(
      (await this.dataSource.getRepository(RecurringCharge).find({
        where: { complexId, isActive: true },
        select: ['concept'],
      })).map(r => r.concept.trim().toLowerCase()),
    );

    let totalGenerated = 0;
    let totalSkipped = 0;

    for (const config of activeConfigs) {
      if (recurringConcepts.has(config.name.trim().toLowerCase())) {
        this.logger.warn(
          `[candado] FeeConfig "${config.name}" coincide con un RecurringCharge activo ` +
          `del complejo ${complexId}; omitido para evitar doble facturación`,
        );
        totalSkipped++;
        continue;
      }

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

      let targetUnits: Unit[];

      if (config.isOptional) {
        if (config.triggerType === FeeConfigTriggerType.VEHICLE) {
          const vehicleRows = await this.vehicleRepo
            .createQueryBuilder('v')
            .select('DISTINCT v.unitId', 'unitId')
            .where('v.complexId = :complexId', { complexId })
            .andWhere("v.status = 'ACTIVE'")
            .andWhere('v.deleted_at IS NULL')
            .getRawMany();
          const vehicleUnitIds = new Set(vehicleRows.map((r: any) => r.unitId));
          targetUnits = allUnits.filter(u => vehicleUnitIds.has(u.id));
        } else if (config.targetRules) {
          targetUnits = this.applyTargetRules(allUnits, config.targetRules);
        } else {
          continue;
        }
      } else {
        targetUnits = await this.resolveTargetUnitsAdvanced(config, allUnits, complexId);
      }

      let configGenerated = 0;

      for (const unit of targetUnits) {
        const description = `${config.name} — ${period}`;

        // Idempotencia propia (re-corrida del mismo FeeConfig)
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

        // Guardia anti-doble-cobro (red de seguridad): ya existe un cargo del
        // MISMO concepto+período para la unidad creado por OTRO motor (p. ej.
        // RecurringCharge, que comparte el formato de descripción "<concepto> —
        // <período>"). Evita facturar dos veces la misma cuota. Determinista por
        // descripción; conceptos con nombres distintos no se consideran colisión.
        const crossSource = await this.chargeRepo.findOne({
          where: { complexId, unitId: unit.id, period, description, deletedAt: null as any },
        });
        if (crossSource) {
          this.logger.warn(
            `[anti-doble-cobro] cargo "${description}" ya existe para unidad ${unit.id} ` +
            `(generado por otro motor); FeeConfig ${config.id} omitido`,
          );
          totalSkipped++;
          continue;
        }

        const dueDate = this.buildDueDate(period, config.dueDayOfMonth, config.billingMode);

        // Descuento de pronto pago: usar earlyPaymentAmount si la unidad está al día
        let chargeAmount: number = Number(config.amount);
        let normalAmount: number | null = null;
        let earlyPaymentDueDate: Date | null = null;

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
            earlyPaymentDueDate = this.buildDueDate(
              period,
              config.earlyPaymentDueDayOfMonth ?? config.dueDayOfMonth,
              config.billingMode,
            );
          }
        }

        await this.chargeRepo.save(
          this.chargeRepo.create({
            complexId, unitId: unit.id, feeConfigId: config.id,
            period, dueDate, amount: chargeAmount, normalAmount, earlyPaymentDueDate, paidAmount: 0,
            description,
            status: ChargeStatus.PENDING,
            prelacionConcept: config.prelacionConcept,
          }),
        );
        configGenerated++;
        totalGenerated++;

        this.notifyChargeGeneratedToUnit(complexId, unit.id, config.name, chargeAmount, period).catch(err =>
          this.logger.warn(`Error al notificar cargo generado en unidad ${unit.id} (config ${config.id}): ${err?.message}`),
        );
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

    if (totalGenerated > 0) {
      // Reconciliar el saldo materializado de las unidades del complejo
      for (const u of allUnits) {
        await this.accountingService.recomputeUnitStatus(this.dataSource.manager, complexId, u.id);
      }
      this.socketService.emitToComplex(complexId, SocketEvent.FINANCE_CHARGE_NEW, { period, created: totalGenerated });
    }

    return { generated: totalGenerated, skipped: totalSkipped, period };
  }

  /**
   * Crea cargos inmediatos para configs con triggerType=VEHICLE cuando un vehículo pasa a ACTIVE.
   * Idempotente: omite si ya existe cargo para la misma config+unidad+período.
   */
  async triggerVehicleCharges(unitId: string, complexId: string): Promise<void> {
    // Best-effort: la causación de cargos NUNCA debe tumbar el registro del vehículo.
    try {
      // Modelo nuevo (canónico): cargos por vehículo vía RecurringCharge triggerType=VEHICLE.
      await this.accountingService.causeVehicleChargesForUnit(complexId, unitId, SYSTEM_USER_ID);

      const vehicleConfigs = await this.feeConfigRepo.find({
        where: {
          complexId,
          isActive: true,
          isOptional: true,
          triggerType: FeeConfigTriggerType.VEHICLE,
          deletedAt: null as any,
        },
      });

      if (!vehicleConfigs.length) return;

      const today = new Date();
      const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

      for (const config of vehicleConfigs) {
        const existing = await this.chargeRepo.findOne({
          where: { feeConfigId: config.id, unitId, period },
        });
        if (existing) continue;

        const dueDate = this.buildDueDate(period, config.dueDayOfMonth, config.billingMode);
        await this.chargeRepo.save(
          this.chargeRepo.create({
            complexId,
            unitId,
            feeConfigId: config.id,
            period,
            dueDate,
            amount: Number(config.amount),
            paidAmount: 0,
            description: `${config.name} — ${period}`,
            status: ChargeStatus.PENDING,
            prelacionConcept: config.prelacionConcept,
          }),
        );
      }

      // Reconciliar el saldo materializado de la unidad
      await this.accountingService.recomputeUnitStatus(this.dataSource.manager, complexId, unitId);
    } catch (e: any) {
      this.logger.error(
        `triggerVehicleCharges(unit=${unitId}, complex=${complexId}): ${e?.message}`,
        e?.stack,
      );
    }
  }

  /**
   * Versión interna de applyMoraToPeriod para uso desde cron jobs.
   * Omite la verificación de acceso del usuario; el asiento contable se registra
   * con el usuario de sistema.
   */
  async applyMoraInternal(
    complexId: string,
    period: string,
    rate: number,
    graceDays: number,
  ): Promise<MoraApplicationResult> {
    this.assertValidPeriod(period);
    return this.applyMoraCore(complexId, period, rate, graceDays, SYSTEM_USER_ID);
  }

  /**
   * Aplica mora usando la tasa/gracia de la config del complejo. Devuelve null si
   * no hay tasa configurada (> 0). Usado por el backfill con mora.
   */
  async applyMoraUsingConfig(
    complexId: string,
    period: string,
  ): Promise<MoraApplicationResult | null> {
    const cfg = await this.financeConfigRepo.findOne({ where: { complexId } });
    const rate = cfg ? Number(cfg.moraRate) : 0;
    if (!rate || rate <= 0) return null;
    return this.applyMoraInternal(complexId, period, rate, cfg!.moraGraceDays);
  }

  /**
   * Núcleo de la causación de mora. Recorre TODOS los cargos vencidos de
   * períodos anteriores al mes actual del complejo, calcula el interés y, por
   * cada cargo de mora generado:
   *   1. Crea el FeeCharge de mora (CxC operativa, prelación INTEREST_MORA).
   *   2. Registra el asiento contable (Débito 1345 = Crédito 4210), best-effort.
   *   3. Reconcilia el saldo materializado de la unidad.
   * Todo en una única transacción ACID. Idempotente: omite si ya existe la nota
   * de mora para (unidad, period, descripción).
   *
   * @param period etiqueta YYYY-MM que reciben los cargos de mora generados.
   */
  private async applyMoraCore(
    complexId: string,
    period: string,
    rate: number,
    graceDays: number,
    createdByUserId: string,
  ): Promise<MoraApplicationResult> {
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const overdueCharges = await this.chargeRepo.find({
      where: {
        complexId,
        status: In([ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID]),
        deletedAt: null as any,
      },
    });

    // Procesar solo cargos de períodos ANTERIORES al mes actual.
    // Excluir cargos que YA son de mora para no generar interés sobre interés.
    const chargesToProcess = overdueCharges.filter(
      c => c.period < currentPeriod && c.prelacionConcept !== PrelacionConcept.INTEREST_MORA,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let applied = 0;
    let totalMoraAmount = 0;
    let skipped = 0;

    const moraNotifications: Array<{ unitId: string; complexId: string; amount: number; description: string }> = [];

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
            prelacionConcept: PrelacionConcept.INTEREST_MORA,
            sourceChargeId: charge.id,
          }),
        );

        // Asiento contable de causación de mora (best-effort si hay PUC)
        await this.accountingService.emitMoraNote(queryRunner.manager, {
          complexId: charge.complexId,
          unitId: charge.unitId,
          amount: mora,
          period,
          createdByUserId,
          memo: moraDescription,
        });

        applied++;
        totalMoraAmount += mora;
        moraNotifications.push({
          unitId: charge.unitId,
          complexId: charge.complexId,
          amount: mora,
          description: moraDescription,
        });
      }

      // Reconciliar saldo materializado de las unidades con mora (misma TX)
      const moraUnits = new Map<string, string>(); // unitId -> complexId
      for (const m of moraNotifications) moraUnits.set(m.unitId, m.complexId);
      for (const [uid, cid] of moraUnits) {
        await this.accountingService.recomputeUnitStatus(queryRunner.manager, cid, uid);
      }

      await queryRunner.commitTransaction();

      for (const m of moraNotifications) {
        this.notifyMoraApplied(m.unitId, m.complexId, m.amount, m.description).catch(err =>
          this.logger.warn(`Error al notificar mora en unidad ${m.unitId}: ${err?.message}`),
        );
      }

      return {
        period,
        applied,
        skipped,
        totalMoraAmount: Math.round(totalMoraAmount * 100) / 100,
      };

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
      isOptional: input.isOptional ?? false,
      createdByUserId: currentUser.sub,
    });

    const savedConfig = await this.feeConfigRepo.save(config);
    await this.cacheService.deleteByPrefix(BK.finance.prefix(input.complexId));

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

    const saved = await this.feeConfigRepo.save(config);
    await this.cacheService.deleteByPrefix(BK.finance.prefix(config.complexId));
    return saved;
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
    await this.cacheService.deleteByPrefix(BK.finance.prefix(config.complexId));

    return true;
  }

  async toggleFeeConfig(
    configId: string,
    currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    const config = await this.findFeeConfigOrFail(configId);
    await this.complexService.findById(config.complexId, currentUser);
    config.isActive = !config.isActive;
    const saved = await this.feeConfigRepo.save(config);
    await this.cacheService.deleteByPrefix(BK.finance.prefix(config.complexId));
    return saved;
  }

  async findFeeConfigsByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<FeeConfig[]> {
    await this.complexService.findById(complexId, currentUser);

    const cacheKey = BK.finance.feeConfigs(complexId);
    const cached = await this.cacheService.get<FeeConfig[]>({ key: cacheKey });
    if (cached) return cached;

    const configs = await this.feeConfigRepo.find({
      where: { complexId, deletedAt: null as any },
      order: { createdAt: 'DESC' },
    });
    await this.cacheService.set({ key: cacheKey, data: configs, options: { ttl: BK.finance.TTL_FEES } });
    return configs;
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

    // Núcleo compartido: misma lógica que el cron (incluye reconciliación de
    // saldos materializados y emisión del socket FINANCE_CHARGE_NEW).
    const result = await this.generateChargesInternal(complexId, period);

    this.logger.log(
      `generateCharges — período ${period}, complejo ${complexId}: ` +
      `${result.generated} generados, ${result.skipped} omitidos.`,
    );

    if (result.generated > 0) {
      void this.auditService.log({
        entityType: AuditEntityType.FeeCharge,
        entityId: complexId,
        action: AuditAction.CREATE,
        newValue: { period, generated: result.generated, skipped: result.skipped, complexId },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId,
        description: `Cargos generados: ${result.generated} para período ${period} — complejo ${complexId}`,
        isBulk: true,
      });
    }

    return result;
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
      // Reconciliar el saldo materializado de las unidades afectadas
      for (const uid of unitIds) {
        await this.accountingService.recomputeUnitStatus(this.dataSource.manager, complexId, uid);
      }

      this.socketService.emitToComplex(complexId, SocketEvent.FINANCE_CHARGE_NEW, {
        complexId,
        period,
        description,
        amount,
        created,
      });

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
        isBulk: true,
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

    // Reconciliar el saldo materializado: el cargo exonerado deja de ser deuda
    await this.accountingService.recomputeUnitStatus(this.dataSource.manager, charge.complexId, charge.unitId);

    this.notifyChargeWaived(savedWaive, reason).catch(err =>
      this.logger.warn(`Error al notificar exoneración de cargo ${chargeId}: ${err?.message}`),
    );

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

      // Nota crédito por descuento de pronto pago: si el cargo queda PAID y se
      // facturó el valor pleno (normalAmount > amount), se acredita el descuento
      // para cuadrar el ledger (best-effort, misma TX).
      const discount = charge.normalAmount != null
        ? Math.round((Number(charge.normalAmount) - Number(charge.amount)) * 100) / 100
        : 0;
      if (charge.status === ChargeStatus.PAID && discount > 0) {
        await this.accountingService.emitEarlyDiscountCreditNote(queryRunner.manager, {
          complexId: charge.complexId,
          unitId: charge.unitId,
          incomeAccountId: charge.incomeAccountId ?? null,
          amount: discount,
          period: charge.period,
          createdByUserId: currentUser.sub,
        });
      }

      // Reconciliar el saldo materializado de la unidad (misma TX)
      await this.accountingService.recomputeUnitStatus(queryRunner.manager, charge.complexId, charge.unitId);

      // Recibo de caja contable (best-effort; omitido si la copropiedad no tiene PUC)
      await this.accountingService.emitCashReceipt(queryRunner.manager, {
        complexId: charge.complexId,
        unitId: charge.unitId,
        documentDate: new Date(input.paidAt),
        period: charge.period,
        appliedToCharges: Number(input.amount),
        prepaidExcess: 0,
        method: input.method,
        createdByUserId: currentUser.sub,
        reference: input.reference,
      });

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

      this.socketService.emitToComplex(charge.complexId, SocketEvent.FINANCE_PAYMENT_REGISTERED, {
        paymentId: savedPayment.id,
        chargeId: charge.id,
        unitId: charge.unitId,
        amount: input.amount,
        chargeStatus: charge.status,
      });

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

        // Nota crédito por descuento pronto pago si el cargo quedó PAID con descuento.
        if (charge.status === ChargeStatus.PAID && charge.normalAmount != null) {
          const bulkDiscount = Math.round((Number(charge.normalAmount) - Number(charge.amount)) * 100) / 100;
          if (bulkDiscount > 0) {
            await this.accountingService.emitEarlyDiscountCreditNote(queryRunner.manager, {
              complexId,
              unitId,
              incomeAccountId: charge.incomeAccountId ?? null,
              amount: bulkDiscount,
              period: charge.period,
              createdByUserId: currentUser.sub,
            });
          }
        }

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

      // Reconciliar el saldo materializado de la unidad (misma TX)
      await this.accountingService.recomputeUnitStatus(queryRunner.manager, complexId, unitId);

      // Recibo de caja contable: parte imputada a cargos + excedente a anticipo (2805)
      const appliedToCharges = Math.round((amount - remaining) * 100) / 100;
      const receiptDate = new Date(paidAt);
      await this.accountingService.emitCashReceipt(queryRunner.manager, {
        complexId,
        unitId,
        documentDate: receiptDate,
        period: `${receiptDate.getFullYear()}-${String(receiptDate.getMonth() + 1).padStart(2, '0')}`,
        appliedToCharges,
        prepaidExcess: remaining > 0.001 ? Math.round(remaining * 100) / 100 : 0,
        method,
        createdByUserId: currentUser.sub,
        reference,
      });

      await queryRunner.commitTransaction();

      this.socketService.emitToComplex(complexId, SocketEvent.FINANCE_PAYMENT_REGISTERED, {
        unitId,
        totalAmount: amount,
        chargesSettled: paid,
      });

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
        isBulk: true,
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

      // Reconciliar el saldo materializado de la unidad (misma TX)
      await this.accountingService.recomputeUnitStatus(queryRunner.manager, charge.complexId, charge.unitId);

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

      this.notifyPaymentReversed(charge, Number(payment.amount), reason).catch(err =>
        this.logger.warn(`Error al notificar anulación de pago ${paymentId}: ${err?.message}`),
      );

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

    const entry = await this.dataSource.transaction(async (em) => {
      const saved = await em.save(
        WalletEntry,
        em.create(WalletEntry, {
          type: 'CREDIT',
          amount: input.amount,
          description: input.description,
          unitId: input.unitId,
          complexId: input.complexId,
          chargeId: null,
        }),
      );
      // Reconciliar el saldo materializado de la unidad (misma TX)
      await this.accountingService.recomputeUnitStatus(em, input.complexId, input.unitId);
      return saved;
    });

    this.notifyWalletCredit(input.unitId, input.complexId, Number(input.amount), input.description).catch(err =>
      this.logger.warn(`Error al notificar saldo a favor en unidad ${input.unitId}: ${err?.message}`),
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

      // Reconciliar el saldo materializado de la unidad (misma TX)
      await this.accountingService.recomputeUnitStatus(queryRunner.manager, input.complexId, input.unitId);

      // Nota contable de aplicación de anticipo (best-effort; 2805 → 1311)
      await this.accountingService.emitPrepaidApplicationNote(queryRunner.manager, {
        complexId: input.complexId,
        unitId: input.unitId,
        amount: montoAplicado,
        period: charge.period,
        createdByUserId: currentUser.sub,
        memo: `Aplicación manual de anticipo — ${charge.description}`,
      });

      // Nota crédito por descuento pronto pago si el cargo quedó PAID con descuento.
      const walletDiscount = charge.normalAmount != null
        ? Math.round((Number(charge.normalAmount) - Number(charge.amount)) * 100) / 100
        : 0;
      if (charge.status === ChargeStatus.PAID && walletDiscount > 0) {
        await this.accountingService.emitEarlyDiscountCreditNote(queryRunner.manager, {
          complexId: input.complexId,
          unitId: input.unitId,
          incomeAccountId: charge.incomeAccountId ?? null,
          amount: walletDiscount,
          period: charge.period,
          createdByUserId: currentUser.sub,
        });
      }

      await queryRunner.commitTransaction();

      this.notifyWalletApplied(charge, Math.round(montoAplicado * 100) / 100).catch(err =>
        this.logger.warn(`Error al notificar aplicación de saldo en cargo ${charge.id}: ${err?.message}`),
      );

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
   * Calcula y registra mora sobre los cargos vencidos del complejo usando la
   * tasa y días de gracia indicados en el input. `input.period` es solo la
   * etiqueta de período que reciben los cargos de mora generados.
   */
  async applyMoraToPeriod(
    input: ApplyMoraInput,
    currentUser: JwtAccessPayload,
  ): Promise<MoraApplicationResult> {
    await this.complexService.findById(input.complexId, currentUser);
    this.assertValidPeriod(input.period);

    const result = await this.applyMoraCore(
      input.complexId, input.period, input.rate, input.graceDays, currentUser.sub,
    );

    this.logger.log(
      `applyMoraToPeriod — período ${input.period}, complejo ${input.complexId}: ` +
      `${result.applied} cargos de mora creados, ${result.skipped} omitidos.`,
    );
    return result;
  }

  /**
   * Endpoint de respaldo (disparo manual del cron de mora): aplica mora a TODOS
   * los períodos vencidos del complejo usando la tasa y días de gracia
   * configurados en su ComplexFinanceConfig. Los cargos de mora se etiquetan con
   * el período del mes actual (Bogotá). Idempotente.
   */
  async applyMoraAllPeriods(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MoraApplicationResult> {
    await this.complexService.findById(complexId, currentUser);

    const config = await this.financeConfigRepo.findOne({ where: { complexId } });
    const rate      = config ? Number(config.moraRate) : 0;
    const graceDays = config ? config.moraGraceDays : 0;

    if (rate <= 0) {
      throw new CustomError({
        message: 'La copropiedad no tiene una tasa de mora (moraRate) configurada',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.INVALID_AMOUNT,
      });
    }

    const now    = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const result = await this.applyMoraCore(complexId, period, rate, graceDays, currentUser.sub);

    this.logger.log(
      `applyMoraAllPeriods — complejo ${complexId}, período ${period}: ` +
      `${result.applied} cargos de mora creados, ${result.skipped} omitidos.`,
    );
    return result;
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

    // Derivación read-time de OVERDUE: un cargo PENDING/PARTIALLY_PAID con saldo
    // y dueDate pasado se considera vencido aunque el cron aún no lo haya transicionado.
    const now = new Date();
    if (filters.status === ChargeStatus.OVERDUE) {
      qb.andWhere(
        `(c.status = :overdue OR (c.status IN (:...openStatuses) AND c.dueDate < :now AND (c.amount - c.paidAmount) > 0))`,
        {
          overdue: ChargeStatus.OVERDUE,
          openStatuses: [ChargeStatus.PENDING, ChargeStatus.PARTIALLY_PAID],
          now,
        },
      );
    } else if (filters.status === ChargeStatus.PENDING) {
      // Excluir los vencidos por fecha: deben aparecer bajo "Vencido", no "Pendiente".
      qb.andWhere(
        `c.status = :pending AND NOT (c.dueDate < :now AND (c.amount - c.paidAmount) > 0)`,
        { pending: ChargeStatus.PENDING, now },
      );
    } else if (filters.status) {
      qb.andWhere('c.status = :status', { status: filters.status });
    }
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

    await this.populateMoraAmount(items);

    return {
      items,
      pagination: {
        currentPage: page, itemsPerPage: limit, totalItems, totalPages,
        hasNextPage: page < totalPages, hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Llena el campo no persistido `moraAmount` de cada cargo con la suma del saldo
   * de sus filas de mora (INTEREST_MORA) asociadas vía `sourceChargeId`. Una sola
   * query agregada para todos los cargos (evita N+1).
   */
  private async populateMoraAmount(charges: FeeCharge[]): Promise<void> {
    if (!charges.length) return;
    const ids = charges.map(c => c.id);

    const rows = await this.chargeRepo
      .createQueryBuilder('m')
      .select('m.sourceChargeId', 'sourceChargeId')
      .addSelect('SUM(m.amount - m.paidAmount)', 'mora')
      .where('m.sourceChargeId IN (:...ids)', { ids })
      .andWhere('m.prelacionConcept = :concept', { concept: PrelacionConcept.INTEREST_MORA })
      .andWhere('m.status NOT IN (:...closed)', {
        closed: [ChargeStatus.PAID, ChargeStatus.CANCELLED, ChargeStatus.WAIVED],
      })
      .andWhere('m.deletedAt IS NULL')
      .groupBy('m.sourceChargeId')
      .getRawMany<{ sourceChargeId: string; mora: string }>();

    const byParent = new Map(rows.map(r => [r.sourceChargeId, Number(r.mora)]));
    for (const c of charges) {
      c.moraAmount = byParent.get(c.id) ?? 0;
    }
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
    const overdueCount = charges.filter(c => c.effectiveStatus === ChargeStatus.OVERDUE).length;
    // "Pendientes" = total de cargos por pagar (incluye vencidos); overdue es el subconjunto.
    const pendingCount = pendingCharges.length;

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

    // totalCharged: todos los cargos del período (periódicos + directos), excluye WAIVED y CANCELLED
    const chargedRow = await this.chargeRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount), 0)', 'total')
      .where('c.complexId = :complexId', { complexId })
      .andWhere('c.period = :period', { period })
      .andWhere('c.status NOT IN (:...excluded)', {
        excluded: [ChargeStatus.WAIVED, ChargeStatus.CANCELLED],
      })
      .andWhere('c.deletedAt IS NULL')
      .getRawOne<{ total: string }>();
    const totalCharged = Number(chargedRow?.total ?? 0);

    // totalCollected: pagos sobre TODOS los cargos del período, no revertidos
    const collectedRow = await this.paymentRepo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'total')
      .innerJoin('p.charge', 'c')
      .where('c.complexId = :complexId', { complexId })
      .andWhere('c.period = :period', { period })
      .andWhere('p.isReversed = false')
      .andWhere('c.deletedAt IS NULL')
      .getRawOne<{ total: string }>();
    const totalCollected = Number(collectedRow?.total ?? 0);

    // totalOutstanding: deuda acumulada de TODOS los períodos (sin filtro de period)
    const outstandingRow = await this.chargeRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount - c.paidAmount), 0)', 'total')
      .where('c.complexId = :complexId', { complexId })
      .andWhere('c.amount - c.paidAmount > 0')
      .andWhere('c.status IN (:...debtStatuses)', {
        debtStatuses: [ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID],
      })
      .andWhere('c.deletedAt IS NULL')
      .getRawOne<{ total: string }>();
    const totalOutstanding = Number(outstandingRow?.total ?? 0);

    // periodOutstanding: cartera pendiente SOLO de los cargos de este período
    const periodOutstandingRow = await this.chargeRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount - c.paidAmount), 0)', 'total')
      .where('c.complexId = :complexId', { complexId })
      .andWhere('c.period = :period', { period })
      .andWhere('c.amount - c.paidAmount > 0')
      .andWhere('c.status IN (:...debtStatuses)', {
        debtStatuses: [ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID],
      })
      .andWhere('c.deletedAt IS NULL')
      .getRawOne<{ total: string }>();
    const periodOutstanding = Number(periodOutstandingRow?.total ?? 0);

    // totalMora: interés de mora causado en el período (prelación INTEREST_MORA)
    const moraRow = await this.chargeRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount), 0)', 'total')
      .where('c.complexId = :complexId', { complexId })
      .andWhere('c.period = :period', { period })
      .andWhere('c.prelacionConcept = :mora', { mora: PrelacionConcept.INTEREST_MORA })
      .andWhere('c.status NOT IN (:...excluded)', {
        excluded: [ChargeStatus.WAIVED, ChargeStatus.CANCELLED],
      })
      .andWhere('c.deletedAt IS NULL')
      .getRawOne<{ total: string }>();
    const totalMora = Number(moraRow?.total ?? 0);

    // unitsWithDebt / unitsFullyPaid: misma lógica que getUnitsFinancialStatus
    const allUnitStatuses = await this.getAllUnitStatusItems(complexId);
    const unitsWithDebt = allUnitStatuses.filter(u => u.status === 'OVERDUE' || u.status === 'IN_DEBT').length;
    const unitsFullyPaid = allUnitStatuses.filter(u => u.status === 'UP_TO_DATE' || u.status === 'CREDIT').length;

    // totalExpenses: comprobantes de egreso del LEDGER (EXPENSE_VOUCHER) del período,
    // excluyendo los reversados. Es el mecanismo canónico (createExpenseVoucher);
    // antes sumaba la tabla legacy ComplexExpense, que el editor nuevo ya no escribe.
    const ledgerExp = await this.dataSource.query(
      `SELECT COALESCE(SUM("totalDebit"), 0) AS total
         FROM accounting_headers
        WHERE "complexId" = $1 AND period = $2
          AND "documentType" = 'EXPENSE_VOUCHER'
          AND "reversedByHeaderId" IS NULL`,
      [complexId, period],
    );
    const totalExpenses = Number(ledgerExp?.[0]?.total ?? 0);

    return {
      complexId,
      period,
      totalCharged: Math.round(totalCharged * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      periodOutstanding: Math.round(periodOutstanding * 100) / 100,
      totalMora: Math.round(totalMora * 100) / 100,
      collectionRate: totalCharged > 0 ? Math.round((totalCollected / totalCharged) * 10000) / 100 : 0,
      unitsWithDebt,
      unitsFullyPaid,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netCashFlow: Math.round((totalCollected - totalExpenses) * 100) / 100,
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
   try {
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

    const toIso = (d: Date | null | undefined): string => (d ? new Date(d) : new Date()).toISOString();

    for (const charge of charges) {
      movements.push({
        id: `charge-${charge.id}`,
        date: toIso(charge.createdAt),
        type: 'CHARGE',
        description: charge.description ?? '',
        debit: Number(charge.amount) || 0,
        credit: 0,
        balance: 0,
        reference: undefined,
      });
    }

    for (const p of payments) {
      const methodRef = p.reference ? ` — ${p.reference}` : '';
      movements.push({
        id: `payment-${p.id}`,
        date: toIso(p.paidAt),
        type: 'PAYMENT',
        description: `Pago — ${p.method ?? ''}${methodRef}`,
        debit: 0,
        credit: Number(p.amount) || 0,
        balance: 0,
        reference: p.reference ?? undefined,
      });
    }

    for (const entry of walletEntries) {
      if (entry.type === 'CREDIT') {
        movements.push({
          id: `wallet-${entry.id}`,
          date: toIso(entry.createdAt),
          type: 'CREDIT',
          description: entry.description ?? '',
          debit: 0,
          credit: Number(entry.amount) || 0,
          balance: 0,
          reference: undefined,
        });
      } else if (entry.type === 'DEBIT') {
        movements.push({
          id: `wallet-${entry.id}`,
          date: toIso(entry.createdAt),
          type: 'DEBIT',
          description: 'Aplicación saldo a favor',
          debit: Number(entry.amount) || 0,
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
      unitNumber: unitInfo.number ?? '',
      building: unitInfo.building ?? undefined,
      totalDebits: Math.round(totalDebits * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      currentBalance: Math.round(currentBalance * 100) / 100,
      walletBalance: Math.round(walletBalance * 100) / 100,
      movements,
    };
   } catch (err: any) {
      this.logger.error(
        `getUnitAccountStatement(unit=${unitId}, complex=${complexId}, period=${period ?? 'null'}): ${err?.message}`,
        err?.stack,
      );
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ESTADO FINANCIERO DE UNIDADES
  // ─────────────────────────────────────────────────────────────────────────────

  private async getAllUnitStatusItems(complexId: string) {
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
      .leftJoin(
        qb => qb
          .select('c.unitId', 'unit_id')
          .addSelect(
            `SUM(CASE WHEN c.status IN ('${ChargeStatus.PENDING}','${ChargeStatus.OVERDUE}','${ChargeStatus.PARTIALLY_PAID}') THEN c.amount - c.paidAmount ELSE 0 END)`,
            'total_debt',
          )
          .addSelect(
            `SUM(CASE WHEN c.status = '${ChargeStatus.OVERDUE}'
                       OR (c.status IN ('${ChargeStatus.PENDING}','${ChargeStatus.PARTIALLY_PAID}')
                           AND c.dueDate < NOW() AND (c.amount - c.paidAmount) > 0)
                     THEN 1 ELSE 0 END)`,
            'overdue_count',
          )
          .addSelect(
            `SUM(CASE WHEN c.status IN ('${ChargeStatus.PENDING}','${ChargeStatus.OVERDUE}','${ChargeStatus.PARTIALLY_PAID}')
                       AND (c.amount - c.paidAmount) > 0
                     THEN 1 ELSE 0 END)`,
            'pending_count',
          )
          .from(FeeCharge, 'c')
          .where('c.complexId = :complexId', { complexId })
          .andWhere('c.deletedAt IS NULL')
          .groupBy('c.unitId'),
        'ch',
        'ch.unit_id = u.id',
      )
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

    return allRows.map((row: any) => {
      const totalDebt = Math.round(Number(row.totalDebt) * 100) / 100;
      const overdueCount = Number(row.overdueCount);
      const pendingCount = Number(row.pendingCount);
      const walletBalance = Math.round(Number(row.walletBalance) * 100) / 100;

      let status: string;
      if (overdueCount > 0) status = 'OVERDUE';
      else if (totalDebt > 0) status = 'IN_DEBT';
      else if (walletBalance > 0) status = 'CREDIT';
      else status = 'UP_TO_DATE';

      return {
        unitId: row.unitId,
        unitNumber: row.unitNumber,
        building: row.building ?? undefined,
        status,
        totalDebt,
        walletBalance,
        overdueCount,
        pendingCount,
      };
    });
  }

  async getUnitsFinancialStatus(
    complexId: string,
    status: string | undefined,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<UnitFinancialStatusPaginated> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const statusOrder: Record<string, number> = { OVERDUE: 0, IN_DEBT: 1, UP_TO_DATE: 2, CREDIT: 3 };

    let items = await this.getAllUnitStatusItems(complexId);

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
  // GASTOS OPERATIVOS DEL COMPLEJO
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Registra un gasto operativo del complejo (compras, reparaciones, servicios, etc.).
   * El gasto queda asociado a un período contable YYYY-MM y descuenta del flujo de caja.
   */
  async registerExpense(
    input: RegisterExpenseInput,
    currentUser: JwtAccessPayload,
  ): Promise<ComplexExpense> {
    await this.complexService.findById(input.complexId, currentUser);
    this.assertValidPeriod(input.period);

    const expense = await this.expenseRepo.save(
      this.expenseRepo.create({
        complexId: input.complexId,
        amount: input.amount,
        description: input.description,
        category: input.category,
        period: input.period,
        expenseDate: new Date(input.expenseDate),
        receiptUrl: input.receiptUrl ?? null,
        notes: input.notes ?? null,
        isReversed: false,
        registeredByUserId: currentUser.entityType === 'user' ? currentUser.sub : null,
      }),
    );

    void this.auditService.log({
      entityType: AuditEntityType.FeeCharge,
      entityId: expense.id,
      action: AuditAction.CREATE,
      newValue: { id: expense.id, amount: expense.amount, category: expense.category, period: expense.period, complexId: input.complexId },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: input.complexId,
      description: `Gasto registrado: "${expense.description}" $${expense.amount} — categoría: ${expense.category} — período: ${expense.period}`,
    });

    return expense;
  }

  /**
   * Revierte un gasto registrado. El monto ya no se descuenta del flujo de caja.
   */
  async reverseExpense(
    expenseId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<ComplexExpense> {
    const expense = await this.findExpenseOrFail(expenseId);
    await this.complexService.findById(expense.complexId, currentUser);

    if (expense.isReversed) {
      throw new CustomError({
        message: 'El gasto ya fue revertido',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.EXPENSE_ALREADY_REVERSED,
      });
    }

    expense.isReversed = true;
    expense.reversalReason = reason;
    expense.reversedByUserId = currentUser.sub;
    expense.reversedAt = new Date();

    const saved = await this.expenseRepo.save(expense);

    void this.auditService.log({
      entityType: AuditEntityType.FeeCharge,
      entityId: expenseId,
      action: AuditAction.UPDATE,
      previousValue: { isReversed: false },
      newValue: { isReversed: true, reason, reversedAt: expense.reversedAt },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: expense.complexId,
      description: `Gasto revertido: "${expense.description}" $${expense.amount} — razón: ${reason}`,
    });

    return saved;
  }

  /**
   * Retorna la lista paginada de gastos del complejo con desglose por categoría.
   */
  async getComplexExpenses(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterExpensesInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedExpensesResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;

    const qb = this.expenseRepo
      .createQueryBuilder('e')
      .where('e.complexId = :complexId', { complexId })
      .andWhere('e.deletedAt IS NULL');

    if (!filters.includeReversed) {
      qb.andWhere('e.isReversed = false');
    }

    if (filters.category) {
      qb.andWhere('e.category = :category', { category: filters.category });
    }

    if (filters.period) {
      qb.andWhere('e.period = :period', { period: filters.period });
    } else {
      if (filters.startDate) {
        qb.andWhere('e.expenseDate >= :startDate', { startDate: filters.startDate });
      }
      if (filters.endDate) {
        qb.andWhere('e.expenseDate <= :endDate', { endDate: filters.endDate });
      }
    }

    qb.orderBy('e.expenseDate', 'DESC').addOrderBy('e.createdAt', 'DESC');

    const totalItems = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
    const totalPages = Math.ceil(totalItems / limit);

    const activeItems = items.filter(e => !e.isReversed);
    const totalAmount = activeItems.reduce((s, e) => s + Number(e.amount), 0);

    const categoryMap = new Map<ExpenseCategory, { total: number; count: number }>();
    for (const e of activeItems) {
      const entry = categoryMap.get(e.category) ?? { total: 0, count: 0 };
      entry.total += Number(e.amount);
      entry.count += 1;
      categoryMap.set(e.category, entry);
    }

    const byCategory: ExpenseCategoryBreakdown[] = Array.from(categoryMap.entries())
      .map(([category, { total, count }]) => ({
        category,
        total: Math.round(total * 100) / 100,
        count,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      items,
      pagination: {
        currentPage: page, itemsPerPage: limit, totalItems, totalPages,
        hasNextPage: page < totalPages, hasPreviousPage: page > 1,
      },
      totalAmount: Math.round(totalAmount * 100) / 100,
      byCategory,
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

  private async findExpenseOrFail(id: string): Promise<ComplexExpense> {
    const expense = await this.expenseRepo.findOne({ where: { id, deletedAt: null as any } });
    if (!expense) {
      throw new CustomError({
        message: 'Gasto no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.EXPENSE_NOT_FOUND,
      });
    }
    return expense;
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

  private applyTargetRules(units: Unit[], rules: FeeConfigTargetRules): Unit[] {
    return units.filter(unit => {
      if (rules.excludeFloor1 && unit.floor === 1) return false;
      if (rules.floorMin != null && unit.floor < rules.floorMin) return false;
      if (rules.floorMax != null && unit.floor > rules.floorMax) return false;
      if (rules.buildingIds?.length && !rules.buildingIds.includes(unit.buildingId)) return false;
      if (rules.unitTypes?.length && !rules.unitTypes.includes(unit.type)) return false;
      return true;
    });
  }

  /** Calcula la fecha de vencimiento a partir del período YYYY-MM y el día de vencimiento. */
  private buildDueDate(
    period: string,
    day: number,
    billingMode: FeeConfigBillingMode = FeeConfigBillingMode.ADVANCE,
  ): Date {
    const [year, month] = period.split('-').map(Number);
    let dueYear = year;
    let dueMonth = month;

    if (billingMode === FeeConfigBillingMode.ARREARS) {
      if (dueMonth === 12) { dueMonth = 1; dueYear += 1; }
      else { dueMonth += 1; }
    }

    const lastDay = new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, Math.min(day, lastDay));
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

  /** Notifica a los residentes de una unidad específica que se le generó un nuevo cargo. */
  private async notifyChargeGeneratedToUnit(
    complexId: string,
    unitId: string,
    configName: string,
    amount: number,
    period: string,
  ): Promise<void> {
    const userIds = await this.resolveUnitUserIds(unitId);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId,
      userIds,
      type: NotificationType.CHARGE_ADDED,
      priority: NotificationPriority.NORMAL,
      title: 'Nuevo cargo generado',
      body: `Se ha generado un cargo por concepto de "${configName}" por un valor de ${this.formatCurrency(amount)} para el período ${period}.`,
      metadata: { unitId, complexId, amount, configName, period },
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
      type: NotificationType.DIRECT_CHARGE,
      priority: NotificationPriority.HIGH,
      title: 'Nuevo cargo aplicado a tu unidad',
      body: `Se ha aplicado un cargo de $${amount.toLocaleString('es-CO')} por concepto: "${description}" para el período ${period}.`,
      metadata: { amount, description, period, unitId, complexId },
    });
  }

  /** Resuelve los userId de los residentes activos de una unidad. */
  private async resolveUnitUserIds(unitId: string): Promise<string[]> {
    const residents = await this.residentsService.findActiveByUnitInternal(unitId);
    return residents.map(r => r.userId).filter(Boolean) as string[];
  }

  /** Notifica a la unidad que un pago fue anulado. */
  private async notifyPaymentReversed(charge: FeeCharge, amount: number, reason: string): Promise<void> {
    const userIds = await this.resolveUnitUserIds(charge.unitId);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: charge.complexId,
      userIds,
      type: NotificationType.PAYMENT_REVERSED,
      priority: NotificationPriority.HIGH,
      title: 'Pago anulado',
      body: `Se ha anulado un pago de ${this.formatCurrency(amount)} aplicado al cargo "${charge.description}". Motivo: ${reason}.`,
      metadata: { chargeId: charge.id, unitId: charge.unitId, amount, reason },
    });
  }

  /** Notifica a la unidad que un cargo fue exonerado. */
  private async notifyChargeWaived(charge: FeeCharge, reason: string): Promise<void> {
    const userIds = await this.resolveUnitUserIds(charge.unitId);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: charge.complexId,
      userIds,
      type: NotificationType.CHARGE_WAIVED,
      priority: NotificationPriority.NORMAL,
      title: 'Cargo exonerado',
      body: `Se ha exonerado el cargo "${charge.description}" por un valor de ${this.formatCurrency(Number(charge.amount))}. Motivo: ${reason}.`,
      metadata: { chargeId: charge.id, unitId: charge.unitId, reason },
    });
  }

  /** Notifica a la unidad que se agregó saldo a favor. */
  private async notifyWalletCredit(
    unitId: string,
    complexId: string,
    amount: number,
    description: string,
  ): Promise<void> {
    const userIds = await this.resolveUnitUserIds(unitId);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId,
      userIds,
      type: NotificationType.WALLET_CREDIT,
      priority: NotificationPriority.NORMAL,
      title: 'Saldo a favor agregado',
      body: `Se ha agregado un saldo a favor de ${this.formatCurrency(amount)} a tu unidad por concepto: "${description}".`,
      metadata: { unitId, complexId, amount, description },
    });
  }

  /** Notifica a la unidad que se aplicó saldo a favor a un cargo. */
  private async notifyWalletApplied(charge: FeeCharge, amount: number): Promise<void> {
    const userIds = await this.resolveUnitUserIds(charge.unitId);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: charge.complexId,
      userIds,
      type: NotificationType.WALLET_APPLIED,
      priority: NotificationPriority.NORMAL,
      title: 'Saldo a favor aplicado',
      body: `Se aplicó ${this.formatCurrency(amount)} de tu saldo a favor al cargo "${charge.description}".`,
      metadata: {
        unitId: charge.unitId,
        complexId: charge.complexId,
        amount,
        chargeId: charge.id,
      } satisfies WalletAppliedMetadata,
    });
  }

  /** Notifica a la unidad que se aplicó un interés de mora. */
  private async notifyMoraApplied(
    unitId: string,
    complexId: string,
    amount: number,
    description: string,
  ): Promise<void> {
    const userIds = await this.resolveUnitUserIds(unitId);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId,
      userIds,
      type: NotificationType.MORA_APPLIED,
      priority: NotificationPriority.HIGH,
      title: 'Interés de mora aplicado',
      body: `Se ha aplicado un interés de mora de ${this.formatCurrency(amount)} por: "${description}".`,
      metadata: { unitId, complexId, amount, description },
    });
  }
}
