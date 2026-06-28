import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { ChargeCategory }                              from '../entities/charge-category.entity';
import { ComplexFinanceConfig }                        from '../entities/complex-finance-config.entity';
import { UpsertComplexFinanceConfigInput }             from '../dto/inputs/upsert-complex-finance-config.input';
import { FeeConfig }                                   from '../entities/fee-config.entity';
import { FeeCharge }                                   from '../entities/fee-charge.entity';
import { Payment }                                     from '../entities/payment.entity';
import { FinanceService }                              from '../services/finance.service';
import { CreateChargeCategoryInput }                   from '../dto/inputs/create-charge-category.input';
import { UpdateChargeCategoryInput }                   from '../dto/inputs/update-charge-category.input';
import { CreateFeeConfigInput }                        from '../dto/inputs/create-fee-config.input';
import { UpdateFeeConfigInput }                        from '../dto/inputs/update-fee-config.input';
import { GenerateChargesInput }                        from '../dto/inputs/generate-charges.input';
import { RegisterPaymentInput }                        from '../dto/inputs/register-payment.input';
import { FilterChargesInput }                          from '../dto/inputs/filter-charges.input';
import { CreateDirectChargesInput }                    from '../dto/inputs/create-direct-charges.input';
import { RegisterBulkPaymentInput }                    from '../dto/inputs/register-bulk-payment.input';
import {
  CreateWalletCreditInput,
  ApplyWalletToChargeInput,
  ApplyMoraInput,
} from '../dto/inputs/wallet.input';
import { PaginatedChargesResponse }                    from '../dto/responses/paginated-charges.response';
import { GenerateChargesResponse }                     from '../dto/responses/generate-charges.response';
import { CreateDirectChargesResponse }                 from '../dto/responses/create-direct-charges.response';
import { RegisterBulkPaymentResponse }                 from '../dto/responses/register-bulk-payment.response';
import { UnitBalanceResponse, ComplexFinancialSummaryResponse } from '../dto/responses/unit-balance.response';
import {
  WalletEntryObject,
  UnitWalletResponse,
  WalletSummaryPaginated,
  ApplyWalletResult,
} from '../dto/responses/wallet.response';
import { UnitAccountStatementResponse }                from '../dto/responses/account-statement.response';
import {
  UnitFinancialStatusPaginated,
  MoraApplicationResult,
} from '../dto/responses/financial-status.response';
import { PaginationInput }                             from '../../shared/dto/inputs/pagination.input';

import { ComplexExpense }                                from '../entities/complex-expense.entity';
import { RegisterExpenseInput }                          from '../dto/inputs/register-expense.input';
import { FilterExpensesInput }                           from '../dto/inputs/filter-expenses.input';
import { PaginatedExpensesResponse }                     from '../dto/responses/paginated-expenses.response';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver()
export class FinanceResolver {

  constructor(private readonly financeService: FinanceService) {}

  // ================================================================
  // COMPLEX FINANCE CONFIG
  // ================================================================

  @Query(() => ComplexFinanceConfig, { name: 'complexFinanceConfig' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_FEE_CONFIGS],
  })
  getComplexFinanceConfig(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ComplexFinanceConfig> {
    return this.financeService.getComplexFinanceConfig(complexId, currentUser);
  }

  @Mutation(() => ComplexFinanceConfig, { name: 'upsertComplexFinanceConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  upsertComplexFinanceConfig(
    @Args('input') input: UpsertComplexFinanceConfigInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ComplexFinanceConfig> {
    return this.financeService.upsertComplexFinanceConfig(input, currentUser);
  }

  // ================================================================
  // CHARGE CATEGORIES
  // ================================================================

  @Query(() => [ChargeCategory], { name: 'chargeCategories' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_FEE_CONFIGS],
  })
  findChargeCategories(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory[]> {
    return this.financeService.findCategoriesByComplex(complexId, currentUser);
  }

  @Mutation(() => ChargeCategory, { name: 'createChargeCategory' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  createChargeCategory(
    @Args('input') input: CreateChargeCategoryInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory> {
    return this.financeService.createCategory(input, currentUser);
  }

  @Mutation(() => ChargeCategory, { name: 'updateChargeCategory' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  updateChargeCategory(
    @Args('input') input: UpdateChargeCategoryInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ChargeCategory> {
    return this.financeService.updateCategory(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'deleteChargeCategory' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  deleteChargeCategory(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.financeService.deleteCategory(id, currentUser);
  }

  // ================================================================
  // FEE CONFIGS
  // ================================================================

  @Mutation(() => FeeConfig, { name: 'createFeeConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  createFeeConfig(
    @Args('input') input: CreateFeeConfigInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    return this.financeService.createFeeConfig(input, currentUser);
  }

  @Mutation(() => FeeConfig, { name: 'updateFeeConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  updateFeeConfig(
    @Args('input') input: UpdateFeeConfigInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    return this.financeService.updateFeeConfig(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'deleteFeeConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  deleteFeeConfig(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.financeService.deleteFeeConfig(id, currentUser);
  }

  @Mutation(() => FeeConfig, { name: 'toggleFeeConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  toggleFeeConfig(
    @Args('configId') configId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    return this.financeService.toggleFeeConfig(configId, currentUser);
  }

  @Query(() => [FeeConfig], { name: 'feeConfigs' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_FEE_CONFIGS],
  })
  findFeeConfigs(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<FeeConfig[]> {
    return this.financeService.findFeeConfigsByComplex(complexId, currentUser);
  }

  // ================================================================
  // GENERACIÓN DE CARGOS
  // ================================================================

  @Mutation(() => GenerateChargesResponse, { name: 'generateCharges' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.GENERATE_CHARGES],
  })
  generateCharges(
    @Args('input') input: GenerateChargesInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<GenerateChargesResponse> {
    return this.financeService.generateCharges(input, currentUser);
  }

  @Mutation(() => FeeCharge, { name: 'waiveCharge' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.WAIVE_CHARGE],
  })
  waiveCharge(
    @Args('chargeId') chargeId: string,
    @Args('reason')   reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<FeeCharge> {
    return this.financeService.waiveCharge(chargeId, reason, currentUser);
  }

  @Mutation(() => CreateDirectChargesResponse, { name: 'createDirectCharges' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.GENERATE_CHARGES],
  })
  createDirectCharges(
    @Args('input') input: CreateDirectChargesInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<CreateDirectChargesResponse> {
    return this.financeService.createDirectCharges(input, currentUser);
  }

  // ================================================================
  // PAGOS
  // ================================================================

  @Mutation(() => Payment, { name: 'registerPayment' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,
    ],
    permissions: [ValidPermissions.REGISTER_PAYMENT],
  })
  registerPayment(
    @Args('input') input: RegisterPaymentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Payment> {
    return this.financeService.registerPayment(input, currentUser);
  }

  @Mutation(() => RegisterBulkPaymentResponse, { name: 'registerBulkPayment' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,
    ],
    permissions: [ValidPermissions.REGISTER_PAYMENT],
  })
  registerBulkPayment(
    @Args('input') input: RegisterBulkPaymentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<RegisterBulkPaymentResponse> {
    return this.financeService.registerBulkPayment(input, currentUser);
  }

  @Mutation(() => Payment, { name: 'reversePayment' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.REVERSE_PAYMENT],
  })
  reversePayment(
    @Args('paymentId') paymentId: string,
    @Args('reason')    reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Payment> {
    return this.financeService.reversePayment(paymentId, reason, currentUser);
  }

  // ================================================================
  // WALLET — SALDO A FAVOR
  // ================================================================

  @Mutation(() => WalletEntryObject, { name: 'createWalletCredit' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.REGISTER_PAYMENT],
  })
  createWalletCredit(
    @Args('input') input: CreateWalletCreditInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<WalletEntryObject> {
    return this.financeService.createWalletCredit(input, currentUser);
  }

  @Mutation(() => ApplyWalletResult, { name: 'applyWalletToCharge' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.REGISTER_PAYMENT],
  })
  applyWalletToCharge(
    @Args('input') input: ApplyWalletToChargeInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ApplyWalletResult> {
    return this.financeService.applyWalletToCharge(input, currentUser);
  }

  @Mutation(() => MoraApplicationResult, { name: 'applyMoraToPeriod' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.GENERATE_CHARGES],
  })
  applyMoraToPeriod(
    @Args('input') input: ApplyMoraInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MoraApplicationResult> {
    return this.financeService.applyMoraToPeriod(input, currentUser);
  }

  /**
   * Respaldo manual del cron de mora: aplica mora a todos los períodos vencidos
   * usando la tasa y días de gracia configurados en la copropiedad.
   */
  @Mutation(() => MoraApplicationResult, { name: 'applyMoraAllPeriods' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.GENERATE_CHARGES],
  })
  applyMoraAllPeriods(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MoraApplicationResult> {
    return this.financeService.applyMoraAllPeriods(complexId, currentUser);
  }

  // ================================================================
  // QUERIES — Cargos
  // ================================================================

  @Query(() => PaginatedChargesResponse, { name: 'charges' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_CHARGES],
  })
  findCharges(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterChargesInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedChargesResponse> {
    return this.financeService.findChargesByComplex(complexId, pagination, filters, currentUser);
  }

  @Query(() => [Payment], { name: 'paymentsByCharge' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PAYMENTS],
  })
  findPaymentsByCharge(
    @Args('chargeId') chargeId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Payment[]> {
    return this.financeService.findPaymentsByCharge(chargeId, currentUser);
  }

  // ================================================================
  // QUERIES — Reportes
  // ================================================================

  @Query(() => UnitBalanceResponse, { name: 'unitBalance' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_ACCOUNT_BALANCE],
  })
  getUnitBalance(
    @Args('unitId')    unitId: string,
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnitBalanceResponse> {
    return this.financeService.getUnitBalance(unitId, complexId, currentUser);
  }

  @Query(() => ComplexFinancialSummaryResponse, { name: 'complexFinancialSummary' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_FINANCIAL_REPORTS],
  })
  getComplexFinancialSummary(
    @Args('complexId') complexId: string,
    @Args('period')    period: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ComplexFinancialSummaryResponse> {
    return this.financeService.getComplexFinancialSummary(complexId, period, currentUser);
  }

  @Query(() => UnitWalletResponse, { name: 'unitWallet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_ACCOUNT_BALANCE],
  })
  getUnitWallet(
    @Args('unitId')    unitId: string,
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnitWalletResponse> {
    return this.financeService.getUnitWallet(unitId, complexId, currentUser);
  }

  @Query(() => WalletSummaryPaginated, { name: 'walletsSummary' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_FINANCIAL_REPORTS],
  })
  getWalletsSummary(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<WalletSummaryPaginated> {
    return this.financeService.getWalletsSummary(complexId, pagination, currentUser);
  }

  @Query(() => UnitAccountStatementResponse, { name: 'unitAccountStatement' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_ACCOUNT_BALANCE],
  })
  getUnitAccountStatement(
    @Args('unitId')                                   unitId: string,
    @Args('complexId')                                complexId: string,
    @Args('period', { nullable: true })               period: string,
    @Args('limit',  { type: () => Int, nullable: true })  limit: number,
    @Args('offset', { type: () => Int, nullable: true })  offset: number,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnitAccountStatementResponse> {
    return this.financeService.getUnitAccountStatement(unitId, complexId, period, currentUser, limit, offset);
  }

  @Query(() => UnitFinancialStatusPaginated, { name: 'unitsFinancialStatus' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_FINANCIAL_REPORTS],
  })
  getUnitsFinancialStatus(
    @Args('complexId')                      complexId: string,
    @Args('status',     { nullable: true }) status: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnitFinancialStatusPaginated> {
    return this.financeService.getUnitsFinancialStatus(complexId, status, pagination, currentUser);
  }

  // ================================================================
  // GASTOS OPERATIVOS DEL COMPLEJO
  // ================================================================

  @Mutation(() => ComplexExpense, { name: 'registerExpense' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_EXPENSES],
  })
  registerExpense(
    @Args('input') input: RegisterExpenseInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ComplexExpense> {
    return this.financeService.registerExpense(input, currentUser);
  }

  @Mutation(() => ComplexExpense, { name: 'reverseExpense' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.MANAGE_EXPENSES],
  })
  reverseExpense(
    @Args('expenseId') expenseId: string,
    @Args('reason')    reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ComplexExpense> {
    return this.financeService.reverseExpense(expenseId, reason, currentUser);
  }

  @Query(() => PaginatedExpensesResponse, { name: 'complexExpenses' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
    permissions: [ValidPermissions.VIEW_EXPENSES],
  })
  getComplexExpenses(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterExpensesInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedExpensesResponse> {
    return this.financeService.getComplexExpenses(complexId, pagination, filters, currentUser);
  }
}
