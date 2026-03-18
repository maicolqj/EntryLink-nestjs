import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { FeeConfig }                          from '../entities/fee-config.entity';
import { FeeCharge }                          from '../entities/fee-charge.entity';
import { Payment }                            from '../entities/payment.entity';
import { FinanceService }                     from '../services/finance.service';
import { CreateFeeConfigInput }               from '../dto/inputs/create-fee-config.input';
import { GenerateChargesInput }               from '../dto/inputs/generate-charges.input';
import { RegisterPaymentInput }               from '../dto/inputs/register-payment.input';
import { FilterChargesInput }                 from '../dto/inputs/filter-charges.input';
import { PaginatedChargesResponse }           from '../dto/responses/paginated-charges.response';
import { GenerateChargesResponse }            from '../dto/responses/generate-charges.response';
import { UnitBalanceResponse, ComplexFinancialSummaryResponse } from '../dto/responses/unit-balance.response';
import { PaginationInput }                    from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver()
export class FinanceResolver {

  constructor(private readonly financeService: FinanceService) {}

  // ================================================================
  // FEE CONFIGS
  // ================================================================

  @Mutation(() => FeeConfig, { name: 'createFeeConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_FEE_CONFIGS],
  })
  createFeeConfig(
    @Args('input') input: CreateFeeConfigInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<FeeConfig> {
    return this.financeService.createFeeConfig(input, currentUser);
  }

  @Mutation(() => FeeConfig, { name: 'toggleFeeConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
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
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.SUPERVISOR_ROL,
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

  /**
   * Genera cargos para todas las unidades del complejo en un período.
   * Operación idempotente: omite los que ya fueron generados.
   */
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

  /**
   * Exonera / cancela un cargo. El residente no deberá pagar ese monto.
   */
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

  // ================================================================
  // PAGOS
  // ================================================================

  @Mutation(() => Payment, { name: 'registerPayment' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.REGISTER_PAYMENT],
  })
  registerPayment(
    @Args('input') input: RegisterPaymentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Payment> {
    return this.financeService.registerPayment(input, currentUser);
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
  // QUERIES — Cargos
  // ================================================================

  @Query(() => PaginatedChargesResponse, { name: 'charges' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.SUPERVISOR_ROL,
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
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.SUPERVISOR_ROL,
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
      ValidRoles.ACCOUNTANT_ROL,  ValidRoles.SUPERVISOR_ROL,
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
      ValidRoles.ACCOUNTANT_ROL,
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
}
