import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException } from '@nestjs/common';

import { Auth } from '../../shared/decorators/auth.decorator';
import { AllowWhenSuspended } from '../../shared/decorators/allow-when-suspended.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ComplexReferralsService } from '../services/complex-referrals.service';
import { ComplexReferralSummary } from '../dto/responses/complex-referral.response';
import { SetComplexReferrerInput } from '../dto/inputs/set-complex-referrer.input';

/** Recomendar a otro conjunto también sirve para renovar: se ve aunque esté suspendida. */
@AllowWhenSuspended()
@Resolver()
export class ComplexReferralsResolver {
  constructor(private readonly service: ComplexReferralsService) {}

  @Query(() => ComplexReferralSummary, {
    name: 'myComplexReferral',
    description:
      'Código de recomendación del complejo de la sesión y los conjuntos que llegaron con él.',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL] })
  myComplexReferral(
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexReferralSummary> {
    // La cuenta del complejo inicia sesión con sub = complex.id.
    const complexId =
      user.complexId ?? (user.entityType === 'complex' ? user.sub : undefined);
    if (!complexId) {
      throw new ForbiddenException('La sesión no pertenece a un complejo');
    }
    return this.service.getSummary(complexId);
  }

  @Query(() => ComplexReferralSummary, {
    name: 'complexReferral',
    description:
      'Código de recomendación de un complejo, quién lo recomendó y a quiénes recomendó. Solo plataforma.',
  })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  complexReferral(
    @Args('complexId', { type: () => ID }) complexId: string,
  ): Promise<ComplexReferralSummary> {
    return this.service.getSummary(complexId);
  }

  @Mutation(() => ComplexReferralSummary, {
    name: 'setComplexReferrer',
    description:
      'Asigna o quita el conjunto que recomendó a otro. La cortesía se otorga con el siguiente pago registrado; ya otorgada, no se cambia.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  setComplexReferrer(
    @Args('input') input: SetComplexReferrerInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexReferralSummary> {
    return this.service.setReferrer(input, user.sub);
  }
}
