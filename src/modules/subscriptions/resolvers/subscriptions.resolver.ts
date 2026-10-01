import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException } from '@nestjs/common';

import { Auth } from '../../shared/decorators/auth.decorator';
import { AllowWhenSuspended } from '../../shared/decorators/allow-when-suspended.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { SubscriptionsService } from '../services/subscriptions.service';
import { SubscriptionSummary } from '../dto/responses/subscription-summary.response';
import { SubscriptionPlanPriceView } from '../dto/responses/subscription-plan-price-view.response';
import { RenewSubscriptionInput } from '../dto/inputs/renew-subscription.input';
import { GrantTrialInput } from '../dto/inputs/grant-trial.input';
import { AdjustSubscriptionInput } from '../dto/inputs/adjust-subscription.input';
import { SetPlanPriceInput } from '../dto/inputs/set-plan-price.input';

/** La suscripción se consulta y se renueva aunque esté suspendida. */
@AllowWhenSuspended()
@Resolver()
export class SubscriptionsResolver {
  constructor(private readonly service: SubscriptionsService) {}

  // ── Administración del conjunto ──────────────────────────────────

  @Query(() => SubscriptionSummary, {
    name: 'mySubscription',
    description: 'Suscripción del complejo de la sesión (administración).',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL] })
  mySubscription(
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionSummary> {
    // La cuenta del complejo inicia sesión con sub = complex.id.
    const complexId =
      user.complexId ?? (user.entityType === 'complex' ? user.sub : undefined);
    if (!complexId) {
      throw new ForbiddenException('La sesión no pertenece a un complejo');
    }
    return this.service.getSummary(complexId);
  }

  @Query(() => [SubscriptionPlanPriceView], {
    name: 'subscriptionPlanPrices',
    description: 'Precios vigentes de los planes pagos.',
  })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,
    ],
  })
  subscriptionPlanPrices(): Promise<SubscriptionPlanPriceView[]> {
    return this.service.listPrices();
  }

  // ── SUPER_ADMIN ──────────────────────────────────────────────────

  @Query(() => SubscriptionSummary, {
    name: 'complexSubscription',
    description: 'Suscripción e historial de un complejo. Solo plataforma.',
  })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  complexSubscription(
    @Args('complexId', { type: () => ID }) complexId: string,
  ): Promise<SubscriptionSummary> {
    return this.service.getSummary(complexId);
  }

  @Mutation(() => SubscriptionSummary, {
    name: 'renewComplexSubscription',
    description:
      'Registra el pago de un periodo mensual o anual. Si aún no vence, el periodo nuevo arranca al terminar el actual.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  renewComplexSubscription(
    @Args('input') input: RenewSubscriptionInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionSummary> {
    return this.service.renew(input, user.sub);
  }

  @Mutation(() => SubscriptionSummary, {
    name: 'grantComplexTrial',
    description: 'Otorga la prueba gratis de 30 días (una vez por complejo).',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  grantComplexTrial(
    @Args('input') input: GrantTrialInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionSummary> {
    return this.service.grantTrial(input, user.sub);
  }

  @Mutation(() => SubscriptionSummary, {
    name: 'adjustComplexSubscription',
    description: 'Corrige a mano el vencimiento vigente, con motivo.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  adjustComplexSubscription(
    @Args('input') input: AdjustSubscriptionInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionSummary> {
    return this.service.adjustEndsAt(input, user.sub);
  }

  @Mutation(() => SubscriptionPlanPriceView, {
    name: 'setSubscriptionPlanPrice',
    description:
      'Fija el precio mensual (y opcionalmente el anual) de un plan.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  setSubscriptionPlanPrice(
    @Args('input') input: SetPlanPriceInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionPlanPriceView> {
    return this.service.setPlanPrice(input, user.sub);
  }
}
