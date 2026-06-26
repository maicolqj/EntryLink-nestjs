import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { ChargeEmission }       from '../entities/charge-emission.entity';
import { ChargeEmissionStatus } from '../enums/charge-emission-status.enum';
import { CreateChargeEmissionInput } from '../dto/inputs/create-charge-emission.input';
import { ChargeEmissionPreviewResponse } from '../dto/responses/charge-emission-preview.response';
import { ChargeEmissionService } from '../services/charge-emission.service';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

/** Roles que pueden emitir/confirmar cargos (admin del complejo y contador). */
const EMIT_ROLES = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL];
const VIEW_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
  ValidRoles.ACCOUNTANT_ROL,  ValidRoles.COMPILANCE_OFFICER_ROL,
];

@Resolver(() => ChargeEmission)
export class ChargeEmissionResolver {

  constructor(private readonly service: ChargeEmissionService) {}

  // ─── Queries ──────────────────────────────────────────────────

  @Query(() => [ChargeEmission], { name: 'chargeEmissions' })
  @Auth({ roles: VIEW_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  chargeEmissions(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
    @Args('status', { type: () => ChargeEmissionStatus, nullable: true }) status?: ChargeEmissionStatus,
    @Args('period', { nullable: true }) period?: string,
  ): Promise<ChargeEmission[]> {
    return this.service.chargeEmissions(complexId, currentUser, status, period);
  }

  @Query(() => ChargeEmission, { name: 'chargeEmission' })
  @Auth({ roles: VIEW_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  chargeEmission(
    @Args('emissionId') emissionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ChargeEmission> {
    return this.service.chargeEmission(emissionId, currentUser);
  }

  @Query(() => ChargeEmissionPreviewResponse, { name: 'previewChargeEmission' })
  @Auth({ roles: VIEW_ROLES, permissions: [ValidPermissions.VIEW_FEE_CONFIGS] })
  previewChargeEmission(
    @Args('emissionId') emissionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ChargeEmissionPreviewResponse> {
    return this.service.previewChargeEmission(emissionId, currentUser);
  }

  // ─── Mutations ────────────────────────────────────────────────

  @Mutation(() => ChargeEmission, { name: 'createChargeEmission' })
  @Auth({ roles: EMIT_ROLES, permissions: [ValidPermissions.MANAGE_FEE_CONFIGS] })
  createChargeEmission(
    @Args('input') input: CreateChargeEmissionInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ChargeEmission> {
    return this.service.createChargeEmission(input, currentUser);
  }

  @Mutation(() => ChargeEmission, { name: 'confirmChargeEmission' })
  @Auth({ roles: EMIT_ROLES, permissions: [ValidPermissions.MANAGE_FEE_CONFIGS] })
  confirmChargeEmission(
    @Args('emissionId') emissionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ChargeEmission> {
    return this.service.confirmChargeEmission(emissionId, currentUser);
  }

  @Mutation(() => ChargeEmission, { name: 'cancelChargeEmission' })
  @Auth({ roles: EMIT_ROLES, permissions: [ValidPermissions.MANAGE_FEE_CONFIGS] })
  cancelChargeEmission(
    @Args('emissionId') emissionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
    @Args('reason', { nullable: true }) reason?: string,
  ): Promise<ChargeEmission> {
    return this.service.cancelChargeEmission(emissionId, currentUser, reason);
  }
}
