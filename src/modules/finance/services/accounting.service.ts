import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThan, Repository } from 'typeorm';

import { PucAccount } from '../entities/puc-account.entity';
import { AccountingHeader } from '../entities/accounting-header.entity';
import { AccountingLine } from '../entities/accounting-line.entity';
import { PropertyAccountStatus } from '../entities/property-account-status.entity';
import { DocumentSequence } from '../entities/document-sequence.entity';
import { FeeCharge } from '../entities/fee-charge.entity';
import { RecurringCharge } from '../entities/recurring-charge.entity';
import { ComplexFinanceConfig } from '../entities/complex-finance-config.entity';
import { WalletEntry } from '../entities/wallet-entry.entity';

import { AccountingDocumentType } from '../enums/accounting-document-type.enum';
import { ChargeStatus } from '../enums/charge-status.enum';
import { RecurringChargeType } from '../enums/recurring-charge-type.enum';
import { FeeConfigBillingMode } from '../enums/fee-config-billing-mode.enum';
import { RecurringChargeDistribution } from '../enums/recurring-charge-distribution.enum';
import { RecurringChargeTrigger } from '../enums/recurring-charge-trigger.enum';
import { PaymentMethod } from '../enums/payment-method.enum';
import {
  PrelacionConcept,
  comparePrelacion,
} from '../enums/prelacion-concept.enum';
import { CreateExpenseInput } from '../dto/inputs/create-expense.input';
import { CreateRecurringChargeInput } from '../dto/inputs/create-recurring-charge.input';
import { UpdateRecurringChargeInput } from '../dto/inputs/update-recurring-charge.input';
import { FeeConfigTargetRules } from '../dto/inputs/fee-config-target-rules.input';
import { ProcessPrepaidBalancesInput } from '../dto/inputs/process-prepaid-balances.input';
import {
  PrepaidApplicationItem,
  PrepaidApplicationResult,
} from '../dto/responses/prepaid-application.response';

import { CustomError } from '../../shared/utils/errors.utils';
import { FinanceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { VehicleStatus } from '../../vehicles/enums/vehicle-status.enum';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { WalletAppliedMetadata } from '../../notifications/interfaces/notification-metadata.interface';
import { AuditService }    from '../../audit/services/audit.service';
import { AuditAction }     from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { FilterAccountingDocumentsInput } from '../dto/inputs/filter-accounting-documents.input';
import { PaginatedAccountingDocumentsResponse } from '../dto/responses/paginated-accounting-documents.response';
import { CreatePucAccountInput } from '../dto/inputs/create-puc-account.input';
import { UpdatePucAccountInput } from '../dto/inputs/update-puc-account.input';
import { seedPucForComplex } from '../../../core/database/seeds/puc.seed';

/** Cuentas PUC estándar usadas por los procesos automáticos. */
const PUC = {
  CASH:                '1105', // Caja
  BANK:                '1110', // Bancos
  PREPAID_LIABILITY:   '2805', // Ingresos recibidos por anticipado (anticipos)
  RECEIVABLE:          '1311', // Cuotas de administración por cobrar (CxC)
  INTEREST_RECEIVABLE: '1345', // Multas e intereses por cobrar (CxC interés mora)
  MORA_INCOME:         '4210', // Intereses de mora (ingreso)
} as const;

/** Convierte a centavos enteros para comparar sin error de coma flotante. */
const cents = (n: number): number => Math.round(n * 100);

/** Redondea a 2 decimales. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    @InjectRepository(PucAccount)
    private readonly pucRepo: Repository<PucAccount>,
    @InjectRepository(RecurringCharge)
    private readonly recurringRepo: Repository<RecurringCharge>,
    private readonly dataSource: DataSource,
    private readonly complexService: ResidentialComplexService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // QUERIES DE LECTURA DEL LEDGER
  // ───────────────────────────────────────────────────────────────────────────

  /** Árbol/listado del PUC de una copropiedad, ordenado por código. */
  async findPucAccounts(
    complexId: string,
    onlyPostable: boolean,
    currentUser: JwtAccessPayload,
  ): Promise<PucAccount[]> {
    await this.complexService.findById(complexId, currentUser);
    return this.pucRepo.find({
      where: { complexId, ...(onlyPostable ? { isPostable: true } : {}) },
      order: { code: 'ASC' },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GESTIÓN DEL PUC (siembra + CRUD con integridad)
  // ───────────────────────────────────────────────────────────────────────────

  /** Siembra idempotente del PUC base para una copropiedad existente. */
  async seedPucAccounts(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<PucAccount[]> {
    await this.complexService.findById(complexId, currentUser);
    await seedPucForComplex(this.dataSource, complexId);
    void this.auditPuc(currentUser, complexId, AuditAction.CREATE, complexId, {
      action: 'seedPucAccounts',
    }, `Siembra del PUC para complejo ${complexId}`);
    return this.pucRepo.find({ where: { complexId }, order: { code: 'ASC' } });
  }

  /** Crea una cuenta PUC. `code` único por complejo; deriva `level` del padre. */
  async createPucAccount(
    input: CreatePucAccountInput,
    currentUser: JwtAccessPayload,
  ): Promise<PucAccount> {
    await this.complexService.findById(input.complexId, currentUser);

    const dup = await this.pucRepo.findOne({
      where: { complexId: input.complexId, code: input.code },
    });
    if (dup) {
      throw new CustomError({
        message: `Ya existe una cuenta con el código ${input.code} en esta copropiedad`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_CODE_DUPLICATE,
      });
    }

    let level = 1;
    let parent: PucAccount | null = null;
    if (input.parentId) {
      parent = await this.pucRepo.findOne({
        where: { id: input.parentId, complexId: input.complexId },
      });
      if (!parent) {
        throw new CustomError({
          message: 'Cuenta padre no encontrada en esta copropiedad',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: FinanceErrorCode.PUC_ACCOUNT_INVALID,
        });
      }
      level = parent.level + 1;
    }

    const acc = await this.pucRepo.save(
      this.pucRepo.create({
        complexId: input.complexId,
        code: input.code,
        name: input.name,
        accountClass: input.accountClass,
        nature: input.nature,
        isPostable: input.isPostable ?? true,
        isActive: true,
        level,
        parentId: input.parentId ?? null,
      }),
    );

    // Un padre con hijos deja de ser hoja (no puede recibir asientos).
    if (parent && parent.isPostable) {
      parent.isPostable = false;
      await this.pucRepo.save(parent);
    }

    void this.auditPuc(currentUser, input.complexId, AuditAction.CREATE, acc.id,
      { code: acc.code, name: acc.name, accountClass: acc.accountClass },
      `Cuenta PUC creada: ${acc.code} — ${acc.name}`);
    return acc;
  }

  /**
   * Actualiza nombre/estado/naturaleza. No permite cambiar code/clase (no expuestos).
   * Si la cuenta tiene movimientos, bloquea cambiar la naturaleza (alteraría reportes).
   */
  async updatePucAccount(
    input: UpdatePucAccountInput,
    currentUser: JwtAccessPayload,
  ): Promise<PucAccount> {
    await this.complexService.findById(input.complexId, currentUser);
    const acc = await this.requirePucAccount(input.id, input.complexId);

    if (input.nature != null && input.nature !== acc.nature) {
      if (await this.hasMovements(this.dataSource.manager, acc.id)) {
        throw new CustomError({
          message: 'No se puede cambiar la naturaleza de una cuenta con movimientos',
          statusCode: HttpStatus.CONFLICT,
          errorCode: FinanceErrorCode.PUC_ACCOUNT_HAS_MOVEMENTS,
        });
      }
      acc.nature = input.nature;
    }
    if (input.name != null)     acc.name = input.name;
    if (input.isActive != null) {
      if (input.isActive === false) await this.assertCanDeactivate(acc);
      acc.isActive = input.isActive;
    }

    const saved = await this.pucRepo.save(acc);
    void this.auditPuc(currentUser, input.complexId, AuditAction.UPDATE, acc.id,
      { name: saved.name, nature: saved.nature, isActive: saved.isActive },
      `Cuenta PUC actualizada: ${saved.code}`);
    return saved;
  }

  /** Alterna isActive. Bloquea desactivar si tiene movimientos o saldo abierto. */
  async togglePucAccount(
    id: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<PucAccount> {
    await this.complexService.findById(complexId, currentUser);
    const acc = await this.requirePucAccount(id, complexId);

    if (acc.isActive) await this.assertCanDeactivate(acc);
    acc.isActive = !acc.isActive;

    const saved = await this.pucRepo.save(acc);
    void this.auditPuc(currentUser, complexId, AuditAction.UPDATE, acc.id,
      { isActive: saved.isActive }, `Cuenta PUC ${saved.isActive ? 'activada' : 'desactivada'}: ${saved.code}`);
    return saved;
  }

  /**
   * Borra una cuenta PUC. Bloquea si tiene movimientos, hijos, o es cuenta de
   * ingreso de algún recurrente. Sin dependencias → borrado físico.
   */
  async deletePucAccount(
    id: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    await this.complexService.findById(complexId, currentUser);
    const acc = await this.requirePucAccount(id, complexId);

    if (await this.hasMovements(this.dataSource.manager, acc.id)) {
      throw new CustomError({
        message: 'No se puede borrar una cuenta con movimientos contables; desactívela',
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_HAS_MOVEMENTS,
      });
    }
    const children = await this.pucRepo.count({ where: { parentId: acc.id } });
    if (children > 0) {
      throw new CustomError({
        message: 'No se puede borrar una cuenta con subcuentas',
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_IN_USE,
      });
    }
    const usedByRecurring = await this.recurringRepo.count({ where: { incomeAccountId: acc.id } });
    if (usedByRecurring > 0) {
      throw new CustomError({
        message: 'La cuenta está asignada a un cobro recurrente; reasígnelo antes de borrar',
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_IN_USE,
      });
    }

    await this.pucRepo.remove(acc);
    void this.auditPuc(currentUser, complexId, AuditAction.DELETE, id,
      { code: acc.code }, `Cuenta PUC borrada: ${acc.code}`);
    return true;
  }

  /** Bloquea desactivar una cuenta con movimientos o saldo materializado abierto. */
  private async assertCanDeactivate(acc: PucAccount): Promise<void> {
    if (await this.hasMovements(this.dataSource.manager, acc.id)) {
      throw new CustomError({
        message: 'No se puede desactivar una cuenta con movimientos abiertos',
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_HAS_MOVEMENTS,
      });
    }
  }

  /** true si la cuenta tiene al menos una línea contable imputada. */
  private async hasMovements(em: EntityManager, pucAccountId: string): Promise<boolean> {
    const n = await em.count(AccountingLine, { where: { pucAccountId } });
    return n > 0;
  }

  private async requirePucAccount(id: string, complexId: string): Promise<PucAccount> {
    const acc = await this.pucRepo.findOne({ where: { id, complexId } });
    if (!acc) {
      throw new CustomError({
        message: 'Cuenta PUC no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_NOT_FOUND,
      });
    }
    return acc;
  }

  private auditPuc(
    user: JwtAccessPayload,
    complexId: string,
    action: AuditAction,
    entityId: string,
    value: Record<string, unknown>,
    description: string,
  ): void {
    void this.auditService.log({
      entityType:      AuditEntityType.PucAccount,
      entityId,
      action,
      newValue:        value,
      performedById:   user.sub,
      performedByName: user.email,
      performedByRole: user.roles?.[0] ?? '',
      complexId,
      description,
    });
  }

  /** Documentos contables paginados, con filtros opcionales (tipo/período/unidad). */
  async findAccountingDocuments(
    filter: FilterAccountingDocumentsInput,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedAccountingDocumentsResponse> {
    await this.complexService.findById(filter.complexId, currentUser);

    const { page, limit } = pagination;
    const where: Record<string, unknown> = { complexId: filter.complexId };
    if (filter.documentType) where.documentType = filter.documentType;
    if (filter.period)       where.period = filter.period;
    if (filter.unitId)       where.unitId = filter.unitId;

    const [items, totalItems] = await this.dataSource.getRepository(AccountingHeader).findAndCount({
      where,
      relations: ['lines'],
      order: { documentDate: 'DESC', consecutive: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page, itemsPerPage: limit, totalItems, totalPages,
        hasNextPage: page < totalPages, hasPreviousPage: page > 1,
      },
    };
  }

  /** Un documento contable con sus líneas. */
  async findAccountingDocument(
    id: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AccountingHeader> {
    await this.complexService.findById(complexId, currentUser);
    const doc = await this.dataSource.getRepository(AccountingHeader).findOne({
      where: { id, complexId },
      relations: ['lines'],
    });
    if (!doc) {
      throw new CustomError({
        message: 'Documento contable no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.ACCOUNTING_DOC_NOT_FOUND,
      });
    }
    return doc;
  }

  /** Saldo materializado de una unidad (null si aún sin actividad). */
  async findUnitAccountStatus(
    complexId: string,
    unitId: string,
    currentUser: JwtAccessPayload,
  ): Promise<PropertyAccountStatus | null> {
    await this.complexService.findById(complexId, currentUser);
    return this.dataSource.getRepository(PropertyAccountStatus).findOne({
      where: { complexId, unitId },
    });
  }

  /** Cobros recurrentes de una copropiedad. */
  async findRecurringCharges(
    complexId: string,
    onlyActive: boolean,
    currentUser: JwtAccessPayload,
  ): Promise<RecurringCharge[]> {
    await this.complexService.findById(complexId, currentUser);
    return this.recurringRepo.find({
      where: { complexId, ...(onlyActive ? { isActive: true } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RecurringCharge — CRUD mínimo + disparo manual de causación
  // ───────────────────────────────────────────────────────────────────────────

  /** Crea un cobro recurrente. La cuenta de ingreso debe ser una hoja PUC activa. */
  async createRecurringCharge(
    input: CreateRecurringChargeInput,
    user: JwtAccessPayload,
  ): Promise<RecurringCharge> {
    const incomeAcc = await this.pucRepo.findOne({
      where: { id: input.incomeAccountId, complexId: input.complexId, isPostable: true, isActive: true },
    });
    if (!incomeAcc) {
      throw new CustomError({
        message: 'Cuenta de ingreso PUC inválida, inactiva o no posteable',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_INVALID,
      });
    }
    if (input.type === RecurringChargeType.DEFERRED && !input.totalInstallments) {
      throw new CustomError({
        message: 'Los cobros diferidos requieren totalInstallments',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.INVALID_AMOUNT,
      });
    }

    // Distribución: explícita o derivada del flag legacy prorateByCoefficient.
    const distribution =
      input.distribution ??
      (input.prorateByCoefficient ? RecurringChargeDistribution.COEFFICIENT : RecurringChargeDistribution.FIXED_PER_UNIT);

    const targetUnitIds = input.targetUnitIds?.length ? input.targetUnitIds : null;

    const rc = this.recurringRepo.create({
      complexId: input.complexId,
      concept: input.concept,
      type: input.type,
      amount: input.amount,
      totalInstallments: input.totalInstallments ?? null,
      currentInstallment: 0,
      isActive: true,
      billingDay: input.billingDay,
      billingMode: input.billingMode ?? FeeConfigBillingMode.ARREARS,
      incomeAccountId: input.incomeAccountId,
      unitId: input.unitId ?? null,
      distribution,
      triggerType: input.triggerType ?? RecurringChargeTrigger.MANUAL,
      vehicleTypes: input.vehicleTypes?.length ? input.vehicleTypes : null,
      prorateByCoefficient: distribution === RecurringChargeDistribution.COEFFICIENT,
      targetRules: input.targetRules ?? null,
      targetUnitIds,
      earlyDiscountPct: input.earlyDiscountPct ?? null,
      earlyDiscountDay: input.earlyDiscountDay ?? null,
      createdByUserId: user.sub,
    });
    return this.recurringRepo.save(rc);
  }

  async updateRecurringCharge(
    input: UpdateRecurringChargeInput,
    _user: JwtAccessPayload,
  ): Promise<RecurringCharge> {
    const rc = await this.recurringRepo.findOne({
      where: { id: input.id, complexId: input.complexId },
    });
    if (!rc) {
      throw new CustomError({
        message: 'Cobro recurrente no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.RECURRING_CHARGE_NOT_FOUND,
      });
    }

    if (input.incomeAccountId && input.incomeAccountId !== rc.incomeAccountId) {
      const acc = await this.pucRepo.findOne({
        where: { id: input.incomeAccountId, complexId: input.complexId, isPostable: true, isActive: true },
      });
      if (!acc) {
        throw new CustomError({
          message: 'Cuenta de ingreso PUC inválida, inactiva o no posteable',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: FinanceErrorCode.PUC_ACCOUNT_INVALID,
        });
      }
      rc.incomeAccountId = input.incomeAccountId;
    }

    if (input.concept != null) rc.concept = input.concept;
    if (input.amount != null) rc.amount = input.amount;
    if (input.totalInstallments != null) rc.totalInstallments = input.totalInstallments;
    if (input.billingDay != null) rc.billingDay = input.billingDay;
    if (input.billingMode != null) rc.billingMode = input.billingMode;
    if (input.distribution != null) {
      rc.distribution = input.distribution;
      rc.prorateByCoefficient = input.distribution === RecurringChargeDistribution.COEFFICIENT;
    }
    if (input.triggerType != null) rc.triggerType = input.triggerType;
    if (input.vehicleTypes !== undefined) rc.vehicleTypes = input.vehicleTypes?.length ? input.vehicleTypes : null;
    if (input.targetRules !== undefined) rc.targetRules = input.targetRules ?? null;
    if (input.targetUnitIds !== undefined) {
      rc.targetUnitIds = input.targetUnitIds?.length ? input.targetUnitIds : null;
    }
    if (input.earlyDiscountPct !== undefined) rc.earlyDiscountPct = input.earlyDiscountPct ?? null;
    if (input.earlyDiscountDay !== undefined) rc.earlyDiscountDay = input.earlyDiscountDay ?? null;
    if (input.isActive != null) rc.isActive = input.isActive;

    return this.recurringRepo.save(rc);
  }

  /**
   * Elimina la definición de un cobro recurrente. Los cargos ya causados
   * (FeeCharge) NO se eliminan; solo se detiene la programación futura.
   */
  async deleteRecurringCharge(
    id: string,
    complexId: string,
    _user: JwtAccessPayload,
  ): Promise<boolean> {
    const rc = await this.recurringRepo.findOne({ where: { id, complexId } });
    if (!rc) {
      throw new CustomError({
        message: 'Cobro recurrente no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.RECURRING_CHARGE_NOT_FOUND,
      });
    }
    await this.recurringRepo.remove(rc);
    return true;
  }

  /** Disparo manual de la causación de recurrentes para un período (ignora billingDay). */
  async causeRecurringCharges(
    complexId: string,
    period: string,
    user: JwtAccessPayload,
  ): Promise<{ caused: number; skipped: number; totalAmount: number }> {
    return this.causeRecurringChargesInternal(complexId, period, user.sub);
  }

  /**
   * Causa los recurrentes para un RANGO de períodos (backfill). Útil cuando un
   * cargo debe cobrarse "desde" un mes anterior: genera un cargo por cada período
   * desde `fromPeriod` hasta `toPeriod` (inclusive). Idempotente por período/unidad.
   * Los períodos ya vencidos nacen OVERDUE y sin descuento (ver causación).
   */
  async causeRecurringChargesRange(
    complexId: string,
    fromPeriod: string,
    toPeriod: string,
    user: JwtAccessPayload,
  ): Promise<{ caused: number; skipped: number; totalAmount: number; periods: string[] }> {
    const periods = this.buildPeriodRange(fromPeriod, toPeriod);
    if (periods.length === 0) {
      throw new CustomError({
        message: 'Rango de períodos inválido (desde debe ser ≤ hasta, formato YYYY-MM)',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.PERIOD_INVALID_FORMAT,
      });
    }
    let caused = 0, skipped = 0, totalAmount = 0;
    for (const p of periods) {
      const r = await this.causeRecurringChargesInternal(complexId, p, user.sub);
      caused += r.caused; skipped += r.skipped; totalAmount += r.totalAmount;
    }
    return { caused, skipped, totalAmount, periods };
  }

  /**
   * Causa los cargos "por vehículo" (triggerType=VEHICLE) para los vehículos
   * ACTIVOS de una unidad, en el período actual. Lo llama el módulo de vehículos
   * al registrar/aprobar un vehículo. Idempotente (un cargo por vehículo/período).
   * NO marca lastBilledPeriod (eso lo hace la causación mensual masiva).
   */
  async causeVehicleChargesForUnit(
    complexId: string,
    unitId: string,
    systemUserId: string,
  ): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const recs = await em.find(RecurringCharge, {
        where: { complexId, isActive: true, triggerType: RecurringChargeTrigger.VEHICLE },
      });
      if (recs.length === 0) return 0;

      const unitVehicles = await em.find(Vehicle, { where: { complexId, unitId, status: VehicleStatus.ACTIVE } });
      if (unitVehicles.length === 0) return 0;

      const conceptByType: Record<RecurringChargeType, PrelacionConcept> = {
        [RecurringChargeType.INDEFINITE]: PrelacionConcept.ORDINARY,
        [RecurringChargeType.DEFERRED]:   PrelacionConcept.EXTRAORDINARY,
        [RecurringChargeType.ONE_TIME]:   PrelacionConcept.ORDINARY,
      };
      const receivableAcc = await this.requireAccount(em, complexId, PUC.RECEIVABLE);
      const financeCfg = await em.findOne(ComplexFinanceConfig, { where: { complexId } });
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      let created = 0;
      for (const rc of recs) {
        const incomeAcc = await this.requireAccountById(em, complexId, rc.incomeAccountId);
        const dueDate = this.buildPeriodDate(period, rc.billingDay, rc.billingMode);
        const earlyPct = Number(rc.earlyDiscountPct ?? financeCfg?.earlyDiscountPct ?? 0);
        const earlyDay = rc.earlyDiscountDay ?? financeCfg?.earlyDiscountDay ?? null;
        const matching = rc.vehicleTypes?.length
          ? unitVehicles.filter(v => rc.vehicleTypes!.includes(v.type))
          : unitVehicles;
        for (const v of matching) {
          const ok = await this.emitRecurringUnitCharge(em, {
            complexId, unitId, period, description: `${rc.concept} — ${period} — ${v.plate}`,
            unitAmount: Number(rc.amount), dueDate, prelacion: conceptByType[rc.type], conceptName: rc.concept,
            receivableAccId: receivableAcc.id, incomeAccId: incomeAcc.id, incomeAccountIdForCharge: rc.incomeAccountId,
            earlyPct, earlyDay, now, systemUserId,
          });
          if (ok) created++;
        }
      }
      return created;
    });
  }

  /** Lista de períodos YYYY-MM de `from` a `to` inclusive (máx 60 para evitar abusos). */
  private buildPeriodRange(from: string, to: string): string[] {
    const re = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!re.test(from) || !re.test(to)) return [];
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    let cur = fy * 12 + (fm - 1);
    const end = ty * 12 + (tm - 1);
    if (cur > end || end - cur > 60) return [];
    const out: string[] = [];
    while (cur <= end) {
      out.push(`${Math.floor(cur / 12)}-${String((cur % 12) + 1).padStart(2, '0')}`);
      cur++;
    }
    return out;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RECONCILIACIÓN: espejo materializado del saldo de la unidad
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Recalcula `PropertyAccountStatus` desde las fuentes de verdad y lo persiste.
   * Debe llamarse dentro de la MISMA transacción del evento de dinero (mismo `em`)
   * para que vea los FeeCharge/WalletEntry recién escritos.
   *
   *   currentBalance = Σ (amount − paidAmount) de cargos abiertos (deuda)
   *   prepaidBalance = Σ CREDIT − Σ DEBIT del wallet (anticipo disponible, ≥ 0)
   *
   * Idempotente: recalcula desde cero, no acumula deltas (no hay drift).
   */
  async recomputeUnitStatus(
    em: EntityManager,
    complexId: string,
    unitId: string,
  ): Promise<PropertyAccountStatus> {
    const openCharges = await em.find(FeeCharge, {
      where: {
        complexId, unitId,
        status: In([ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID]),
      },
    });
    const debt = openCharges.reduce(
      (s, c) => s + (Number(c.amount) - Number(c.paidAmount)), 0,
    );

    const wallet = await em.find(WalletEntry, { where: { complexId, unitId } });
    const credit = wallet.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + Number(e.amount), 0);
    const debit  = wallet.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + Number(e.amount), 0);
    const prepaid = Math.max(0, credit - debit);

    const st = await this.getOrCreateStatus(em, complexId, unitId);
    st.currentBalance = round2(debt);
    st.prepaidBalance = round2(prepaid);
    st.lastMovementAt = new Date();
    return em.save(PropertyAccountStatus, st);
  }

  /**
   * Backfill único: recalcula `PropertyAccountStatus` para toda unidad con
   * actividad financiera previa (cargos o movimientos de wallet). Idempotente
   * — puede correrse varias veces. Pensado para poblar datos históricos tras
   * introducir el espejo materializado. Si se pasa `complexId`, acota a él.
   */
  async backfillUnitStatuses(complexId?: string): Promise<{ processed: number }> {
    // Pares (complexId, unitId) distintos con actividad en cargos o wallet
    const pairs = new Map<string, { complexId: string; unitId: string }>();

    const collect = async (table: 'fee_charges' | 'wallet_entries') => {
      const qb = this.dataSource.createQueryBuilder()
        .select('DISTINCT t."complexId" AS "complexId", t."unitId" AS "unitId"')
        .from(table, 't');
      if (complexId) qb.where('t."complexId" = :complexId', { complexId });
      const rows = await qb.getRawMany<{ complexId: string; unitId: string }>();
      for (const r of rows) {
        if (r.unitId) pairs.set(`${r.complexId}:${r.unitId}`, r);
      }
    };

    await collect('fee_charges');
    await collect('wallet_entries');

    let processed = 0;
    for (const { complexId: cid, unitId } of pairs.values()) {
      await this.recomputeUnitStatus(this.dataSource.manager, cid, unitId);
      processed++;
    }

    this.logger.log(`[backfill] PropertyAccountStatus recalculado para ${processed} unidad(es)`);
    return { processed };
  }

  /**
   * Emite un RECIBO DE CAJA contable por un pago de la unidad. Debe llamarse en
   * la MISMA transacción del pago (mismo `em`).
   *
   *   Débito Caja/Banco (1105 efectivo / 1110 otros)  = total recibido
   *   Crédito 1311 (CxC)        = parte imputada a cargos
   *   Crédito 2805 (anticipo)   = excedente que quedó como saldo a favor
   *
   * Best-effort: si la copropiedad aún no tiene PUC configurado, NO bloquea el
   * pago — registra advertencia y devuelve null (los complejos no migrados al
   * ledger siguen operando con la capa CxC).
   */
  async emitCashReceipt(
    em: EntityManager,
    params: {
      complexId: string;
      unitId: string;
      documentDate: Date;
      period: string;
      appliedToCharges: number;
      prepaidExcess: number;
      method: PaymentMethod;
      createdByUserId: string;
      reference?: string | null;
    },
  ): Promise<string | null> {
    const applied = round2(params.appliedToCharges);
    const excess  = round2(params.prepaidExcess);
    const total   = round2(applied + excess);
    if (total <= 0) return null;

    // Resolver cuentas; si falta alguna, omitir el recibo sin romper el pago
    let cashAcc: PucAccount, recvAcc: PucAccount | null = null, prepaidAcc: PucAccount | null = null;
    try {
      cashAcc = await this.requireAccount(
        em, params.complexId, params.method === PaymentMethod.CASH ? PUC.CASH : PUC.BANK,
      );
      if (applied > 0) recvAcc    = await this.requireAccount(em, params.complexId, PUC.RECEIVABLE);
      if (excess  > 0) prepaidAcc = await this.requireAccount(em, params.complexId, PUC.PREPAID_LIABILITY);
    } catch (e) {
      if (e instanceof CustomError && e.errorCode === FinanceErrorCode.PUC_ACCOUNT_NOT_FOUND) {
        this.logger.warn(`[cashReceipt] PUC no configurado para complejo ${params.complexId}; recibo omitido`);
        return null;
      }
      throw e;
    }

    const lines: Partial<AccountingLine>[] = [
      {
        pucAccountId: cashAcc.id, debit: total, credit: 0,
        memo: `Recibo de caja${params.reference ? ` ref ${params.reference}` : ''} — ${params.method}`,
        unitId: params.unitId, complexId: params.complexId,
      },
    ];
    if (applied > 0 && recvAcc) {
      lines.push({
        pucAccountId: recvAcc.id, debit: 0, credit: applied,
        memo: `Abono a cartera período ${params.period}`,
        unitId: params.unitId, complexId: params.complexId,
      });
    }
    if (excess > 0 && prepaidAcc) {
      lines.push({
        pucAccountId: prepaidAcc.id, debit: 0, credit: excess,
        memo: `Anticipo (saldo a favor) — unidad ${params.unitId}`,
        unitId: params.unitId, complexId: params.complexId,
      });
    }

    const consecutive = await this.nextConsecutive(em, params.complexId, AccountingDocumentType.CASH_RECEIPT);
    const header = em.create(AccountingHeader, {
      documentType: AccountingDocumentType.CASH_RECEIPT,
      consecutive,
      documentDate: params.documentDate,
      period: params.period,
      memo: `Recibo de caja — unidad ${params.unitId}`,
      totalDebit: total,
      totalCredit: total,
      createdByUserId: params.createdByUserId,
      complexId: params.complexId,
      unitId: params.unitId,
      lines: lines as AccountingLine[],
    });
    return (await em.save(AccountingHeader, header)).id;
  }

  /**
   * Emite la NOTA CRÉDITO del descuento por pronto pago. Se llama cuando un cargo
   * con descuento (normalAmount > amount) queda totalmente pagado dentro de la
   * ventana: el ledger facturó el valor pleno, así que se acredita el descuento.
   *
   *   Débito cuenta de ingreso (reversa el ingreso no recibido)
   *     = Crédito 1311 CxC (baja el saldo que nunca se cobrará)
   *
   * Best-effort: si falta PUC o la cuenta de ingreso, devuelve null sin romper el pago.
   */
  async emitEarlyDiscountCreditNote(
    em: EntityManager,
    params: {
      complexId: string;
      unitId: string;
      incomeAccountId: string | null;
      amount: number;
      period: string;
      createdByUserId: string;
      memo?: string;
    },
  ): Promise<string | null> {
    const amount = round2(params.amount);
    if (amount <= 0 || !params.incomeAccountId) return null;

    let incomeAcc: PucAccount, recvAcc: PucAccount;
    try {
      incomeAcc = await this.requireAccountById(em, params.complexId, params.incomeAccountId);
      recvAcc = await this.requireAccount(em, params.complexId, PUC.RECEIVABLE);
    } catch (e) {
      if (e instanceof CustomError && e.errorCode === FinanceErrorCode.PUC_ACCOUNT_NOT_FOUND) {
        this.logger.warn(`[creditNote] PUC no configurado para complejo ${params.complexId}; nota crédito omitida`);
        return null;
      }
      throw e;
    }

    const memo = params.memo ?? `Descuento pronto pago — período ${params.period}`;
    const lines: Partial<AccountingLine>[] = [
      {
        pucAccountId: incomeAcc.id, debit: amount, credit: 0,
        memo, unitId: params.unitId, complexId: params.complexId,
      },
      {
        pucAccountId: recvAcc.id, debit: 0, credit: amount,
        memo: `Baja CxC por descuento pronto pago — unidad ${params.unitId}`,
        unitId: params.unitId, complexId: params.complexId,
      },
    ];

    const consecutive = await this.nextConsecutive(em, params.complexId, AccountingDocumentType.CREDIT_NOTE);
    const header = em.create(AccountingHeader, {
      documentType: AccountingDocumentType.CREDIT_NOTE,
      consecutive,
      documentDate: new Date(),
      period: params.period,
      memo,
      totalDebit: amount,
      totalCredit: amount,
      createdByUserId: params.createdByUserId,
      complexId: params.complexId,
      unitId: params.unitId,
      lines: lines as AccountingLine[],
    });
    return (await em.save(AccountingHeader, header)).id;
  }

  /**
   * Emite la NOTA CONTABLE de aplicación de un anticipo a cartera. Debe correr
   * en la MISMA transacción del evento (mismo `em`).
   *
   *   Débito 2805 (baja el pasivo anticipo) = Crédito 1311 (baja la CxC)
   *
   * Best-effort: si la copropiedad no tiene PUC configurado, devuelve null y no
   * rompe la operación. La usa `applyWalletToCharge` (aplicación manual de saldo).
   */
  async emitPrepaidApplicationNote(
    em: EntityManager,
    params: {
      complexId: string;
      unitId: string;
      amount: number;
      period: string;
      createdByUserId: string;
      memo?: string;
    },
  ): Promise<string | null> {
    const amount = round2(params.amount);
    if (amount <= 0) return null;

    let prepaidAcc: PucAccount, recvAcc: PucAccount;
    try {
      prepaidAcc = await this.requireAccount(em, params.complexId, PUC.PREPAID_LIABILITY);
      recvAcc    = await this.requireAccount(em, params.complexId, PUC.RECEIVABLE);
    } catch (e) {
      if (e instanceof CustomError && e.errorCode === FinanceErrorCode.PUC_ACCOUNT_NOT_FOUND) {
        this.logger.warn(`[prepaidNote] PUC no configurado para complejo ${params.complexId}; nota omitida`);
        return null;
      }
      throw e;
    }

    const consecutive = await this.nextConsecutive(em, params.complexId, AccountingDocumentType.ACCOUNTING_NOTE);
    const header = em.create(AccountingHeader, {
      documentType: AccountingDocumentType.ACCOUNTING_NOTE,
      consecutive,
      documentDate: new Date(),
      period: params.period,
      memo: params.memo ?? `Aplicación de anticipo — unidad ${params.unitId}`,
      totalDebit: amount,
      totalCredit: amount,
      createdByUserId: params.createdByUserId,
      complexId: params.complexId,
      unitId: params.unitId,
      lines: [
        {
          pucAccountId: prepaidAcc.id, debit: amount, credit: 0,
          memo: params.memo ?? 'Aplicación de anticipo a cartera',
          unitId: params.unitId, complexId: params.complexId,
        },
        {
          pucAccountId: recvAcc.id, debit: 0, credit: amount,
          memo: `Cruce CxC período ${params.period}`,
          unitId: params.unitId, complexId: params.complexId,
        },
      ] as AccountingLine[],
    });
    return (await em.save(AccountingHeader, header)).id;
  }

  /**
   * Emite la NOTA CONTABLE de causación de interés de mora. Debe correr en la
   * MISMA transacción que crea el FeeCharge de mora (mismo `em`).
   *
   *   Débito 1345 (multas e intereses por cobrar) = Crédito 4210 (intereses de mora)
   *
   * Best-effort: si la copropiedad no tiene PUC configurado, devuelve null y NO
   * rompe la causación de mora (los complejos no migrados al ledger siguen
   * operando solo con la capa CxC / FeeCharge).
   */
  async emitMoraNote(
    em: EntityManager,
    params: {
      complexId: string;
      unitId: string;
      amount: number;
      period: string;
      createdByUserId: string;
      memo?: string;
    },
  ): Promise<string | null> {
    const amount = round2(params.amount);
    if (amount <= 0) return null;

    let receivableAcc: PucAccount, incomeAcc: PucAccount;
    try {
      receivableAcc = await this.requireAccount(em, params.complexId, PUC.INTEREST_RECEIVABLE);
      incomeAcc     = await this.requireAccount(em, params.complexId, PUC.MORA_INCOME);
    } catch (e) {
      if (e instanceof CustomError && e.errorCode === FinanceErrorCode.PUC_ACCOUNT_NOT_FOUND) {
        this.logger.warn(`[moraNote] PUC no configurado para complejo ${params.complexId}; nota omitida`);
        return null;
      }
      throw e;
    }

    const consecutive = await this.nextConsecutive(em, params.complexId, AccountingDocumentType.INVOICE);
    const header = em.create(AccountingHeader, {
      documentType: AccountingDocumentType.INVOICE,
      consecutive,
      documentDate: new Date(),
      period: params.period,
      memo: params.memo ?? `Causación interés de mora — unidad ${params.unitId}`,
      totalDebit: amount,
      totalCredit: amount,
      createdByUserId: params.createdByUserId,
      complexId: params.complexId,
      unitId: params.unitId,
      lines: [
        {
          pucAccountId: receivableAcc.id, debit: amount, credit: 0,
          memo: params.memo ?? `Interés de mora período ${params.period}`,
          unitId: params.unitId, complexId: params.complexId,
        },
        {
          pucAccountId: incomeAcc.id, debit: 0, credit: amount,
          memo: `Ingreso interés de mora período ${params.period}`,
          unitId: params.unitId, complexId: params.complexId,
        },
      ] as AccountingLine[],
    });
    return (await em.save(AccountingHeader, header)).id;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. REGISTRAR EGRESO (Comprobante de Gasto)
  //    Partida doble: N débitos a Gasto/CxP = 1 crédito a Caja/Banco.
  // ───────────────────────────────────────────────────────────────────────────

  async registerExpense(
    input: CreateExpenseInput,
    user: JwtAccessPayload,
  ): Promise<AccountingHeader> {

    // 0. Validaciones de lectura (fuera de la TX)
    const total = input.lines.reduce((s, l) => s + l.amount, 0);
    if (total <= 0) {
      throw new CustomError({
        message: 'El egreso debe tener un monto total positivo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.INVALID_AMOUNT,
      });
    }

    // Todas las cuentas deben existir, ser del tenant y ser posteables (hoja)
    const accountIds = [input.paymentAccountId, ...input.lines.map((l) => l.pucAccountId)];
    const uniqueIds = [...new Set(accountIds)];
    const accounts = await this.pucRepo.find({
      where: { id: In(uniqueIds), complexId: input.complexId, isPostable: true, isActive: true },
    });
    if (accounts.length !== uniqueIds.length) {
      throw new CustomError({
        message: 'Una o más cuentas PUC son inválidas, inactivas o no posteables',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_INVALID,
      });
    }

    // 1. Transacción ACID
    return this.dataSource.transaction(async (em) => {

      // 1a. Consecutivo legal con lock pesimista
      const consecutive = await this.nextConsecutive(
        em, input.complexId, AccountingDocumentType.EXPENSE_VOUCHER,
      );

      // 1b. Líneas: N débitos (gasto/CxP) + 1 crédito (caja/banco) por el total
      const lines: Partial<AccountingLine>[] = input.lines.map((l) => ({
        pucAccountId: l.pucAccountId,
        debit: l.amount,
        credit: 0,
        memo: l.memo,                       // justificación POR LÍNEA
        unitId: l.unitId ?? null,
        complexId: input.complexId,
      }));
      lines.push({
        pucAccountId: input.paymentAccountId,
        debit: 0,
        credit: total,                      // sale el dinero de caja/banco
        memo: `Pago ${input.thirdPartyName ?? 'egreso'} — ${input.memo}`,
        complexId: input.complexId,
      });

      // 1c. Invariante partida doble (defensa en profundidad)
      const sumD = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const sumC = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
      if (cents(sumD) !== cents(sumC)) {
        throw new CustomError({
          message: 'Asiento descuadrado: la suma de débitos no es igual a la de créditos',
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          errorCode: FinanceErrorCode.UNBALANCED_ENTRY,
        });
      }

      // 1d. Header INMUTABLE con sus líneas (cascade insert)
      const header = em.create(AccountingHeader, {
        documentType: AccountingDocumentType.EXPENSE_VOUCHER,
        consecutive,
        documentDate: input.documentDate,
        period: input.period,
        memo: input.memo,                   // justificación CABECERA
        thirdPartyName: input.thirdPartyName ?? null,
        totalDebit: sumD,
        totalCredit: sumC,
        createdByUserId: user.sub,          // LOG estricto de quién asentó
        complexId: input.complexId,
        unitId: input.lines.find((l) => l.unitId)?.unitId ?? null,
        lines: lines as AccountingLine[],
      });

      const saved = await em.save(AccountingHeader, header);
      this.logger.log(`Egreso ${saved.consecutive} asentado por user=${user.sub} complex=${input.complexId}`);
      return saved;
    });
    // Cualquier excepción → ROLLBACK total. Nada queda asentado a medias.
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. APLICACIÓN AUTOMÁTICA DE SALDOS A FAVOR (anticipos → deuda nueva)
  //    Asiento: Débito 2805 (baja el pasivo) = Crédito 1311 (baja la CxC).
  // ───────────────────────────────────────────────────────────────────────────

  async applyPrepaidBalances(
    input: ProcessPrepaidBalancesInput,
    user: JwtAccessPayload,
  ): Promise<PrepaidApplicationResult> {

    // Notificaciones por unidad a despachar tras el commit (fire-and-forget).
    const prepaidNotifications: Array<{ unitId: string; amount: number }> = [];

    const result = await this.dataSource.transaction(async (em) => {

      // Cuentas de cruce del tenant
      const prepaidAcc    = await this.requireAccount(em, input.complexId, PUC.PREPAID_LIABILITY);
      const receivableAcc = await this.requireAccount(em, input.complexId, PUC.RECEIVABLE);

      // 1. Unidades con anticipo disponible, bloqueadas para escritura
      const statuses = await em.find(PropertyAccountStatus, {
        where: {
          complexId: input.complexId,
          prepaidBalance: MoreThan(0),
          ...(input.unitIds?.length ? { unitId: In(input.unitIds) } : {}),
        },
        lock: { mode: 'pessimistic_write' },
      });

      const items: PrepaidApplicationItem[] = [];
      let totalApplied = 0;

      for (const st of statuses) {
        if (st.prepaidBalance <= 0) continue;

        // 2. Cargos abiertos de la unidad ordenados por PRELACIÓN legal
        //    (mora → multas → extraordinaria → ordinaria; luego más antiguo).
        const openCharges = await em.find(FeeCharge, {
          where: {
            complexId: input.complexId,
            unitId: st.unitId,
            status: In([ChargeStatus.PENDING, ChargeStatus.OVERDUE, ChargeStatus.PARTIALLY_PAID]),
          },
        });
        if (openCharges.length === 0) continue;
        openCharges.sort(comparePrelacion);

        const originalPrepaid = st.prepaidBalance;
        const originalDebt = Number(st.currentBalance);
        let available = originalPrepaid;
        const applied: Array<{ concept: PrelacionConcept; period: string; amount: number }> = [];

        // 3. Consumir el anticipo cargo por cargo respetando la prelación
        for (const ch of openCharges) {
          if (available <= 0) break;
          const due = Number(ch.amount) - Number(ch.paidAmount);
          if (due <= 0) continue;

          const portion = Math.min(available, due);

          if (!input.dryRun) {
            ch.paidAmount = Number(ch.paidAmount) + portion;
            ch.status = cents(ch.paidAmount) >= cents(Number(ch.amount))
              ? ChargeStatus.PAID
              : ChargeStatus.PARTIALLY_PAID;
            await em.save(FeeCharge, ch); // FeeCharge = CxC operativa (mutable)

            // Wallet = fuente de verdad del anticipo: registrar el consumo (DEBIT)
            await em.save(WalletEntry, em.create(WalletEntry, {
              type: 'DEBIT',
              amount: round2(portion),
              description: `Aplicación de anticipo (prelación) — ${ch.description}`,
              unitId: st.unitId,
              complexId: input.complexId,
              chargeId: ch.id,
            }));
          }

          available -= portion;
          applied.push({ concept: ch.prelacionConcept, period: ch.period, amount: portion });
        }

        const appliedToUnit = originalPrepaid - available;
        if (appliedToUnit <= 0) continue;

        let accountingHeaderId: string | undefined;

        if (!input.dryRun) {
          // 4. Asiento de aplicación: Débito 2805 (baja anticipo) = Crédito 1311 (baja CxC)
          const consecutive = await this.nextConsecutive(
            em, input.complexId, AccountingDocumentType.ACCOUNTING_NOTE,
          );

          const detail = applied.map((a) => `${a.concept} ${a.period}: ${a.amount}`).join('; ');
          const lines: Partial<AccountingLine>[] = [
            {
              pucAccountId: prepaidAcc.id, debit: appliedToUnit, credit: 0,
              memo: `Aplicación de anticipo (prelación) — ${detail}`,
              unitId: st.unitId, complexId: input.complexId,
            },
            {
              pucAccountId: receivableAcc.id, debit: 0, credit: appliedToUnit,
              memo: `Cruce CxC por anticipo — unidad ${st.unitId}`,
              unitId: st.unitId, complexId: input.complexId,
            },
          ];

          const header = em.create(AccountingHeader, {
            documentType: AccountingDocumentType.ACCOUNTING_NOTE,
            consecutive,
            documentDate: new Date(),
            period: input.period,
            memo: `Aplicación automática de saldo a favor — unidad ${st.unitId}`,
            totalDebit: appliedToUnit,
            totalCredit: appliedToUnit,
            createdByUserId: user.sub,
            complexId: input.complexId,
            unitId: st.unitId,
            lines: lines as AccountingLine[],
          });
          accountingHeaderId = (await em.save(AccountingHeader, header)).id;

          // 5. Recalcular el saldo materializado desde las fuentes de verdad
          await this.recomputeUnitStatus(em, input.complexId, st.unitId);

          // Notificar a la unidad que se aplicó su saldo a favor (tras commit)
          prepaidNotifications.push({ unitId: st.unitId, amount: round2(appliedToUnit) });
        }

        totalApplied += appliedToUnit;
        items.push({
          unitId: st.unitId,
          appliedAmount: appliedToUnit,
          remainingPrepaid: available,
          remainingDebt: Math.max(0, originalDebt - appliedToUnit),
          accountingHeaderId,
        });
      }

      return {
        unitsProcessed: items.length,
        totalApplied,
        dryRun: !!input.dryRun,
        items,
      };
    });

    // Despacho de notificaciones fuera de la TX (no bloquea ni revierte el cruce).
    for (const n of prepaidNotifications) {
      this.notifyPrepaidApplied(input.complexId, n.unitId, n.amount).catch(err =>
        this.logger.warn(`Error al notificar aplicación de anticipo en unidad ${n.unitId}: ${err?.message}`),
      );
    }

    return result;
  }

  /**
   * Notifica a los residentes activos de una unidad que se aplicó su saldo a
   * favor (anticipo) para pagar deuda pendiente.
   */
  private async notifyPrepaidApplied(
    complexId: string,
    unitId: string,
    amount: number,
  ): Promise<void> {
    const residents = await this.residentsService.findActiveByUnitInternal(unitId);
    const userIds = residents.map(r => r.userId).filter(Boolean) as string[];
    if (userIds.length === 0) return;

    const formatted = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

    await this.notificationsService.notify({
      complexId,
      userIds,
      type: NotificationType.WALLET_APPLIED,
      priority: NotificationPriority.NORMAL,
      title: 'Saldo a favor aplicado',
      body: `Se aplicaron ${formatted} de tu saldo a favor para pagar cargos pendientes de tu unidad.`,
      metadata: {
        unitId,
        complexId,
        amount,
        chargeId: null,
      } satisfies WalletAppliedMetadata,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. CAUSACIÓN DE COBROS RECURRENTES (factura cuota → ledger + CxC + saldo)
  //    Asiento INVOICE: Débito 1311 (CxC) = Crédito cuenta de ingreso (ej. 4225).
  // ───────────────────────────────────────────────────────────────────────────

  async causeRecurringChargesInternal(
    complexId: string,
    period: string,
    systemUserId: string,
    dueDay?: number,
  ): Promise<{ caused: number; skipped: number; totalAmount: number }> {

    const conceptByType: Record<RecurringChargeType, PrelacionConcept> = {
      [RecurringChargeType.INDEFINITE]: PrelacionConcept.ORDINARY,
      [RecurringChargeType.DEFERRED]:   PrelacionConcept.EXTRAORDINARY,
      [RecurringChargeType.ONE_TIME]:   PrelacionConcept.ORDINARY,
    };

    return this.dataSource.transaction(async (em) => {
      const receivableAcc = await this.requireAccount(em, complexId, PUC.RECEIVABLE);

      const recurrents = await em.find(RecurringCharge, {
        where: { complexId, isActive: true },
      });

      // Config global de pronto pago (override por concepto si el RecurringCharge lo define).
      const financeCfg = await em.findOne(ComplexFinanceConfig, { where: { complexId } });
      const now = new Date();

      let caused = 0;
      let skipped = 0;
      let totalAmount = 0;

      for (const rc of recurrents) {
        if (dueDay != null && rc.billingDay !== dueDay) { skipped++; continue; } // no vence hoy
        if (rc.lastBilledPeriod === period) { skipped++; continue; }            // idempotencia

        const incomeAcc = await this.requireAccountById(em, complexId, rc.incomeAccountId);
        const concept = conceptByType[rc.type];

        // Pronto pago efectivo: override del concepto o el global del complejo.
        const earlyPct = Number(rc.earlyDiscountPct ?? financeCfg?.earlyDiscountPct ?? 0);
        const earlyDay = rc.earlyDiscountDay ?? financeCfg?.earlyDiscountDay ?? null;

        const dueDate = this.buildPeriodDate(period, rc.billingDay, rc.billingMode);
        const common = {
          complexId, period, dueDate, prelacion: concept, conceptName: rc.concept,
          receivableAccId: receivableAcc.id, incomeAccId: incomeAcc.id,
          incomeAccountIdForCharge: rc.incomeAccountId, earlyPct, earlyDay, now, systemUserId,
        };
        let rcCaused = false;

        if (rc.triggerType === RecurringChargeTrigger.VEHICLE) {
          // Un cargo por cada vehículo ACTIVO del/los tipo(s) configurado(s). No segmenta unidades.
          const allVeh = await em.find(Vehicle, { where: { complexId, status: VehicleStatus.ACTIVE } });
          const vehicles = rc.vehicleTypes?.length
            ? allVeh.filter(v => rc.vehicleTypes!.includes(v.type))
            : allVeh;
          if (vehicles.length === 0) { skipped++; continue; }
          for (const v of vehicles) {
            const created = await this.emitRecurringUnitCharge(em, {
              ...common,
              unitId: v.unitId,
              description: `${rc.concept} — ${period} — ${v.plate}`,
              unitAmount: Number(rc.amount),
            });
            if (created) { caused++; totalAmount += Number(rc.amount); rcCaused = true; }
            else skipped++;
          }
        } else {
          // Asignación manual / segmentada (prioridad: manual > unidad única > reglas/todas)
          let targetUnits: Unit[];
          if (rc.targetUnitIds?.length) {
            targetUnits = await em.find(Unit, { where: { id: In(rc.targetUnitIds), complexId } });
          } else if (rc.unitId) {
            targetUnits = await em.find(Unit, { where: { id: rc.unitId, complexId } });
          } else {
            targetUnits = await em.find(Unit, { where: { complexId } });
            if (rc.targetRules) targetUnits = this.applyRecurringTargetRules(targetUnits, rc.targetRules);
          }

          if (targetUnits.length === 0) { skipped++; continue; }

          const description = `${rc.concept} — ${period}`;
          const dist = rc.distribution
            ?? (rc.prorateByCoefficient ? RecurringChargeDistribution.COEFFICIENT : RecurringChargeDistribution.FIXED_PER_UNIT);
          const n = targetUnits.length;
          const allHaveCoef = targetUnits.every(u => u.coefficient != null && Number(u.coefficient) > 0);
          const totalCoef = allHaveCoef ? targetUnits.reduce((s, u) => s + Number(u.coefficient), 0) : 0;
          const useCoef = dist === RecurringChargeDistribution.COEFFICIENT && allHaveCoef && totalCoef > 0;
          if (dist === RecurringChargeDistribution.COEFFICIENT && !useCoef) {
            this.logger.warn(`[causación] recurrente ${rc.id}: coeficiente incompleto en el subgrupo; reparto en partes iguales`);
          }

          let distributed = 0;
          for (let i = 0; i < targetUnits.length; i++) {
            const unit = targetUnits[i];
            const isLast = i === targetUnits.length - 1;
            let unitAmount: number;
            if (dist === RecurringChargeDistribution.FIXED_PER_UNIT) {
              unitAmount = Number(rc.amount);
            } else if (isLast) {
              unitAmount = round2(Number(rc.amount) - distributed);
            } else if (useCoef) {
              unitAmount = round2(Number(rc.amount) * Number(unit.coefficient) / totalCoef);
            } else {
              unitAmount = round2(Number(rc.amount) / n);
            }
            distributed = round2(distributed + unitAmount);

            const created = await this.emitRecurringUnitCharge(em, {
              ...common, unitId: unit.id, description, unitAmount,
            });
            if (created) { caused++; totalAmount += unitAmount; rcCaused = true; }
            else skipped++;
          }
        }

        // Avanzar contadores e idempotencia del recurrente
        if (rcCaused) {
          rc.currentInstallment += 1;
          if (rc.type === RecurringChargeType.ONE_TIME) {
            rc.isActive = false;
          } else if (rc.type === RecurringChargeType.DEFERRED &&
                     rc.totalInstallments != null &&
                     rc.currentInstallment >= rc.totalInstallments) {
            rc.isActive = false;
          }
        }
        rc.lastBilledPeriod = period;
        await em.save(RecurringCharge, rc);
      }

      return { caused, skipped, totalAmount: Math.round(totalAmount * 100) / 100 };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers internos
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Emite el siguiente consecutivo legal para (complexId, documentType).
   * Lock pesimista (FOR UPDATE) → serializa la numeración bajo concurrencia.
   */
  private async nextConsecutive(
    em: EntityManager,
    complexId: string,
    documentType: AccountingDocumentType,
  ): Promise<number> {
    let row = await em.findOne(DocumentSequence, {
      where: { complexId, documentType },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) {
      row = em.create(DocumentSequence, { complexId, documentType, lastNumber: 0 });
    }
    row.lastNumber += 1;
    await em.save(DocumentSequence, row);
    return row.lastNumber;
  }

  /** Resuelve una cuenta PUC por código dentro del tenant o lanza error. */
  private async requireAccount(
    em: EntityManager,
    complexId: string,
    code: string,
  ): Promise<PucAccount> {
    const acc = await em.findOne(PucAccount, {
      where: { complexId, code, isPostable: true, isActive: true },
    });
    if (!acc) {
      throw new CustomError({
        message: `Cuenta PUC ${code} no configurada para esta copropiedad`,
        statusCode: HttpStatus.PRECONDITION_FAILED,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_NOT_FOUND,
      });
    }
    return acc;
  }

  /** Resuelve una cuenta PUC por id dentro del tenant (debe ser hoja activa). */
  private async requireAccountById(
    em: EntityManager,
    complexId: string,
    id: string,
  ): Promise<PucAccount> {
    const acc = await em.findOne(PucAccount, {
      where: { id, complexId, isPostable: true, isActive: true },
    });
    if (!acc) {
      throw new CustomError({
        message: `Cuenta PUC ${id} inválida, inactiva o no posteable`,
        statusCode: HttpStatus.PRECONDITION_FAILED,
        errorCode: FinanceErrorCode.PUC_ACCOUNT_INVALID,
      });
    }
    return acc;
  }

  /** Obtiene (o crea) la fila de saldo materializado de la unidad. */
  private async getOrCreateStatus(
    em: EntityManager,
    complexId: string,
    unitId: string,
  ): Promise<PropertyAccountStatus> {
    let st = await em.findOne(PropertyAccountStatus, { where: { complexId, unitId } });
    if (!st) {
      st = em.create(PropertyAccountStatus, {
        complexId, unitId, currentBalance: 0, prepaidBalance: 0,
      });
    }
    return st;
  }

  /** Construye la fecha de vencimiento dentro del período YYYY-MM acotando el día. */
  /**
   * Crea un cargo de causación para una (unidad, monto, descripción): asiento
   * INVOICE (valor pleno) + FeeCharge (con pronto pago si la ventana sigue abierta,
   * OVERDUE si ya venció) + recálculo del saldo. Idempotente por descripción/período.
   * Devuelve true si lo creó, false si ya existía.
   */
  private async emitRecurringUnitCharge(
    em: EntityManager,
    p: {
      complexId: string; unitId: string; period: string; description: string;
      unitAmount: number; dueDate: Date; prelacion: PrelacionConcept; conceptName: string;
      receivableAccId: string; incomeAccId: string; incomeAccountIdForCharge: string;
      earlyPct: number; earlyDay: number | null; now: Date; systemUserId: string;
    },
  ): Promise<boolean> {
    const exists = await em.findOne(FeeCharge, {
      where: { complexId: p.complexId, unitId: p.unitId, period: p.period, description: p.description },
    });
    if (exists) return false;

    const consecutive = await this.nextConsecutive(em, p.complexId, AccountingDocumentType.INVOICE);
    const lines: Partial<AccountingLine>[] = [
      {
        pucAccountId: p.receivableAccId, debit: p.unitAmount, credit: 0,
        memo: `Causación ${p.conceptName} ${p.period}`, unitId: p.unitId, complexId: p.complexId,
      },
      {
        pucAccountId: p.incomeAccId, debit: 0, credit: p.unitAmount,
        memo: `Ingreso ${p.conceptName} ${p.period}`, unitId: p.unitId, complexId: p.complexId,
      },
    ];
    const header = em.create(AccountingHeader, {
      documentType: AccountingDocumentType.INVOICE,
      consecutive, documentDate: new Date(), period: p.period,
      memo: `Factura ${p.conceptName} — ${p.description}`,
      totalDebit: p.unitAmount, totalCredit: p.unitAmount,
      createdByUserId: p.systemUserId, complexId: p.complexId, unitId: p.unitId,
      lines: lines as AccountingLine[],
    });
    await em.save(AccountingHeader, header);

    // Pronto pago solo si la ventana aún no venció; INVOICE siempre va al valor pleno.
    let chargeAmount = p.unitAmount;
    let normalAmount: number | null = null;
    let earlyPaymentDueDate: Date | null = null;
    if (p.earlyPct > 0 && p.earlyDay != null) {
      const lastDay = new Date(p.dueDate.getFullYear(), p.dueDate.getMonth() + 1, 0).getDate();
      const epd = new Date(p.dueDate.getFullYear(), p.dueDate.getMonth(), Math.min(p.earlyDay, lastDay));
      const discounted = round2(p.unitAmount * (1 - p.earlyPct / 100));
      if (epd > p.now && discounted < p.unitAmount) {
        chargeAmount = discounted; normalAmount = p.unitAmount; earlyPaymentDueDate = epd;
      }
    }
    const chargeStatus = p.dueDate < p.now ? ChargeStatus.OVERDUE : ChargeStatus.PENDING;
    await em.save(FeeCharge, em.create(FeeCharge, {
      complexId: p.complexId, unitId: p.unitId, feeConfigId: null as any,
      period: p.period, dueDate: p.dueDate, amount: chargeAmount, normalAmount, earlyPaymentDueDate, paidAmount: 0,
      description: p.description, status: chargeStatus, prelacionConcept: p.prelacion,
      incomeAccountId: p.incomeAccountIdForCharge,
    }));
    await this.recomputeUnitStatus(em, p.complexId, p.unitId);
    return true;
  }

  /**
   * Fecha de vencimiento del cargo causado.
   * - ADVANCE: vence el `day` del MISMO período.
   * - ARREARS (mes vencido, default): vence el `day` del mes SIGUIENTE, para que
   *   un cargo causado dentro del período no nazca vencido.
   */
  private buildPeriodDate(
    period: string,
    day: number,
    billingMode: FeeConfigBillingMode = FeeConfigBillingMode.ARREARS,
  ): Date {
    const [year, month] = period.split('-').map(Number);
    let dueYear = year;
    let dueMonth = month; // 1-indexed

    if (billingMode === FeeConfigBillingMode.ARREARS) {
      if (dueMonth === 12) { dueMonth = 1; dueYear += 1; }
      else { dueMonth += 1; }
    }

    const lastDay = new Date(dueYear, dueMonth, 0).getDate(); // dueMonth es 1-indexed
    return new Date(dueYear, dueMonth - 1, Math.min(day, lastDay));
  }

  /** Filtra unidades según las reglas de segmentación de un cobro recurrente. */
  private applyRecurringTargetRules(units: Unit[], rules: FeeConfigTargetRules): Unit[] {
    return units.filter(unit => {
      if (rules.excludeFloor1 && unit.floor === 1) return false;
      if (rules.floorMin != null && unit.floor < rules.floorMin) return false;
      if (rules.floorMax != null && unit.floor > rules.floorMax) return false;
      if (rules.buildingIds?.length && !rules.buildingIds.includes(unit.buildingId)) return false;
      if (rules.unitTypes?.length && !rules.unitTypes.includes(unit.type)) return false;
      return true;
    });
  }
}
