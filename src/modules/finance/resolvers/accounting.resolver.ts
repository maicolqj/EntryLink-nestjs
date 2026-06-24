import { Resolver, Mutation, Query, Args } from '@nestjs/graphql';

import { AccountingService } from '../services/accounting.service';
import { FinanceService } from '../services/finance.service';
import { AccountingHeader } from '../entities/accounting-header.entity';
import { RecurringCharge } from '../entities/recurring-charge.entity';
import { PucAccount } from '../entities/puc-account.entity';
import { PropertyAccountStatus } from '../entities/property-account-status.entity';
import { CreateExpenseInput } from '../dto/inputs/create-expense.input';
import { CreatePucAccountInput } from '../dto/inputs/create-puc-account.input';
import { UpdatePucAccountInput } from '../dto/inputs/update-puc-account.input';
import { CreateRecurringChargeInput } from '../dto/inputs/create-recurring-charge.input';
import { UpdateRecurringChargeInput } from '../dto/inputs/update-recurring-charge.input';
import { ProcessPrepaidBalancesInput } from '../dto/inputs/process-prepaid-balances.input';
import { FilterAccountingDocumentsInput } from '../dto/inputs/filter-accounting-documents.input';
import { PrepaidApplicationResult } from '../dto/responses/prepaid-application.response';
import { RecurringCausationResult } from '../dto/responses/recurring-causation.response';
import { PaginatedAccountingDocumentsResponse } from '../dto/responses/paginated-accounting-documents.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

/** Roles con acceso de lectura financiera. */
const READ_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
  ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
];

@Resolver()
export class AccountingResolver {

  constructor(
    private readonly accountingService: AccountingService,
    private readonly financeService: FinanceService,
  ) {}

  // ================================================================
  // QUERIES DE LECTURA DEL LEDGER
  // ================================================================

  /** PUC (árbol de cuentas) de una copropiedad. */
  @Query(() => [PucAccount], { name: 'pucAccounts' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  pucAccounts(
    @Args('complexId') complexId: string,
    @Args('onlyPostable', { type: () => Boolean, nullable: true, defaultValue: false }) onlyPostable: boolean,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PucAccount[]> {
    return this.accountingService.findPucAccounts(complexId, onlyPostable, currentUser);
  }

  /** Documentos contables paginados, con filtros opcionales. */
  @Query(() => PaginatedAccountingDocumentsResponse, { name: 'accountingDocuments' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  accountingDocuments(
    @Args('filter') filter: FilterAccountingDocumentsInput,
    @Args('pagination', { nullable: true }) pagination: PaginationInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedAccountingDocumentsResponse> {
    return this.accountingService.findAccountingDocuments(
      filter, pagination ?? { page: 1, limit: 10 }, currentUser,
    );
  }

  /** Un documento contable con sus líneas. */
  @Query(() => AccountingHeader, { name: 'accountingDocument' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  accountingDocument(
    @Args('id') id: string,
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AccountingHeader> {
    return this.accountingService.findAccountingDocument(id, complexId, currentUser);
  }

  /** Saldo materializado de una unidad. */
  @Query(() => PropertyAccountStatus, { name: 'unitAccountStatus', nullable: true })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  unitAccountStatus(
    @Args('complexId') complexId: string,
    @Args('unitId') unitId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PropertyAccountStatus | null> {
    return this.accountingService.findUnitAccountStatus(complexId, unitId, currentUser);
  }

  /** Cobros recurrentes de una copropiedad. */
  @Query(() => [RecurringCharge], { name: 'recurringCharges' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  recurringCharges(
    @Args('complexId') complexId: string,
    @Args('onlyActive', { type: () => Boolean, nullable: true, defaultValue: false }) onlyActive: boolean,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<RecurringCharge[]> {
    return this.accountingService.findRecurringCharges(complexId, onlyActive, currentUser);
  }

  // ================================================================
  // GESTIÓN DEL PUC
  // ================================================================

  /** Roles con permiso de gestión contable (mutations). */
  // (definido inline en cada @Auth para mantener el patrón existente)

  /** Siembra idempotente del PUC base para una copropiedad existente. */
  @Mutation(() => [PucAccount], { name: 'seedPucAccounts' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  seedPucAccounts(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PucAccount[]> {
    return this.accountingService.seedPucAccounts(complexId, currentUser);
  }

  /** Crea una cuenta del PUC. */
  @Mutation(() => PucAccount, { name: 'createPucAccount' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  createPucAccount(
    @Args('input') input: CreatePucAccountInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PucAccount> {
    return this.accountingService.createPucAccount(input, currentUser);
  }

  /** Actualiza nombre/estado/naturaleza de una cuenta del PUC. */
  @Mutation(() => PucAccount, { name: 'updatePucAccount' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  updatePucAccount(
    @Args('input') input: UpdatePucAccountInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PucAccount> {
    return this.accountingService.updatePucAccount(input, currentUser);
  }

  /** Activa/desactiva una cuenta del PUC. */
  @Mutation(() => PucAccount, { name: 'togglePucAccount' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  togglePucAccount(
    @Args('id') id: string,
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PucAccount> {
    return this.accountingService.togglePucAccount(id, complexId, currentUser);
  }

  /** Borra una cuenta del PUC sin movimientos/dependencias. */
  @Mutation(() => Boolean, { name: 'deletePucAccount' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  deletePucAccount(
    @Args('id') id: string,
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.accountingService.deletePucAccount(id, complexId, currentUser);
  }

  /** Registra un comprobante de egreso contable (gasto / pago a proveedor). */
  @Mutation(() => AccountingHeader, { name: 'createExpenseVoucher' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  registerExpense(
    @Args('input') input: CreateExpenseInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AccountingHeader> {
    return this.accountingService.registerExpense(input, currentUser);
  }

  /** Aplica los saldos a favor (anticipos) a la deuda recién causada. */
  @Mutation(() => PrepaidApplicationResult, { name: 'applyPrepaidBalances' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  applyPrepaidBalances(
    @Args('input') input: ProcessPrepaidBalancesInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PrepaidApplicationResult> {
    return this.accountingService.applyPrepaidBalances(input, currentUser);
  }

  /** Crea un cobro recurrente programado (cuota ordinaria/extraordinaria/único). */
  @Mutation(() => RecurringCharge, { name: 'createRecurringCharge' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  createRecurringCharge(
    @Args('input') input: CreateRecurringChargeInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<RecurringCharge> {
    return this.accountingService.createRecurringCharge(input, currentUser);
  }

  /** Edita un cobro recurrente. Afecta causaciones futuras; no toca cargos ya causados. */
  @Mutation(() => RecurringCharge, { name: 'updateRecurringCharge' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  updateRecurringCharge(
    @Args('input') input: UpdateRecurringChargeInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<RecurringCharge> {
    return this.accountingService.updateRecurringCharge(input, currentUser);
  }

  /** Elimina la definición de un cobro recurrente (no borra los cargos ya causados). */
  @Mutation(() => Boolean, { name: 'deleteRecurringCharge' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  deleteRecurringCharge(
    @Args('id') id: string,
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.accountingService.deleteRecurringCharge(id, complexId, currentUser);
  }

  /** Dispara manualmente la causación de los recurrentes activos para un período. */
  @Mutation(() => RecurringCausationResult, { name: 'causeRecurringCharges' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  causeRecurringCharges(
    @Args('complexId') complexId: string,
    @Args('period') period: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<RecurringCausationResult> {
    return this.accountingService.causeRecurringCharges(complexId, period, currentUser);
  }

  /** Causa los recurrentes para un rango de períodos (backfill desde un mes anterior). */
  @Mutation(() => RecurringCausationResult, { name: 'causeRecurringChargesRange' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  async causeRecurringChargesRange(
    @Args('complexId') complexId: string,
    @Args('fromPeriod') fromPeriod: string,
    @Args('toPeriod') toPeriod: string,
    @Args('applyMora', { type: () => Boolean, nullable: true, defaultValue: false }) applyMora: boolean,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<RecurringCausationResult> {
    const result = await this.accountingService.causeRecurringChargesRange(
      complexId, fromPeriod, toPeriod, currentUser,
    );
    if (applyMora) {
      // Aplica mora sobre todos los períodos vencidos (con la tasa/gracia de la config).
      await this.financeService.applyMoraUsingConfig(complexId, toPeriod);
    }
    return result;
  }
}
