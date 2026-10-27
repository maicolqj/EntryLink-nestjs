import { ForbiddenException } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { SubscriptionPaymentsService } from '../services/subscription-payments.service';
import { SubscriptionPaymentSubmission } from '../entities/subscription-payment-submission.entity';
import { SubscriptionPaymentInfo } from '../dto/responses/subscription-payment-info.response';
import { SubscriptionQuote } from '../dto/responses/subscription-quote.response';
import { Auth } from '../../shared/decorators/auth.decorator';
import { AllowWhenSuspended } from '../../shared/decorators/allow-when-suspended.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Renovación con soporte de pago. El envío y la configuración del QR van por
 * REST (llevan archivos); aquí la lectura y la revisión.
 */
@AllowWhenSuspended()
@Resolver(() => SubscriptionPaymentSubmission)
export class SubscriptionPaymentsResolver {
  constructor(private readonly paymentsService: SubscriptionPaymentsService) {}

  @Query(() => SubscriptionPaymentInfo, {
    name: 'subscriptionPaymentInfo',
    description: 'QR e instrucciones para pagar la suscripción',
  })
  @Auth({
    roles: [
      ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
  })
  subscriptionPaymentInfo(): Promise<SubscriptionPaymentInfo> {
    return this.paymentsService.getPaymentInfo();
  }

  @Query(() => SubscriptionQuote, {
    name: 'myRenewalQuote',
    description:
      'Lo que el conjunto de la sesión debe pagar para renovar (el valor contra el que se valida el soporte)',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL] })
  myRenewalQuote(
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionQuote> {
    return this.paymentsService.renewalQuote(sessionComplexId(user));
  }

  @Query(() => [SubscriptionPaymentSubmission], {
    name: 'mySubscriptionPayments',
    description: 'Soportes de pago enviados por el conjunto de la sesión',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL] })
  mySubscriptionPayments(
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionPaymentSubmission[]> {
    return this.paymentsService.listForComplex(sessionComplexId(user));
  }

  @Query(() => [SubscriptionPaymentSubmission], {
    name: 'complexSubscriptionPayments',
    description: 'Soportes de pago de un conjunto (personal de la plataforma)',
  })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  complexSubscriptionPayments(
    @Args('complexId', { type: () => ID }) complexId: string,
  ): Promise<SubscriptionPaymentSubmission[]> {
    return this.paymentsService.listForComplex(complexId);
  }

  @Mutation(() => SubscriptionPaymentSubmission, {
    name: 'approveSubscriptionPayment',
    description: 'Aprueba el soporte: registra el pago y renueva',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  approveSubscriptionPayment(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionPaymentSubmission> {
    return this.paymentsService.approve(id, user.sub);
  }

  @Mutation(() => SubscriptionPaymentSubmission, {
    name: 'rejectSubscriptionPayment',
    description: 'Rechaza el soporte con motivo; el conjunto puede reenviar',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  rejectSubscriptionPayment(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<SubscriptionPaymentSubmission> {
    return this.paymentsService.reject(id, reason, user.sub);
  }
}

/** La cuenta del complejo inicia sesión con sub = complex.id. */
function sessionComplexId(user: JwtAccessPayload): string {
  const complexId =
    user.complexId ?? (user.entityType === 'complex' ? user.sub : undefined);
  if (!complexId) {
    throw new ForbiddenException('La sesión no pertenece a un complejo');
  }
  return complexId;
}
