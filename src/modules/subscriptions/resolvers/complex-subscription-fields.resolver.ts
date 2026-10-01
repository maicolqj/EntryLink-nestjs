import { Context, Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import { SubscriptionQuote } from '../dto/responses/subscription-quote.response';
import { SubscriptionsService } from '../services/subscriptions.service';
import {
  computeSubscriptionStatus,
  daysUntil,
} from '../utils/subscription-status';

/** Roles que pueden ver lo que paga cada conjunto desde el complejo. */
const PRICE_VIEWERS: string[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
];

/**
 * Estado de la suscripción en el propio complejo, para el listado del
 * SUPER_ADMIN ("Vence") y el banner del panel. Se calcula al vuelo desde
 * `subscriptionEndsAt`: guardarlo dejaría el estado viejo hasta que corriera
 * algún proceso.
 */
@Resolver(() => ResidentialComplex)
export class ComplexSubscriptionFieldsResolver {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @ResolveField(() => SubscriptionStatus, {
    name: 'subscriptionStatus',
    description: 'Estado de la suscripción calculado con su vencimiento',
  })
  subscriptionStatus(
    @Parent() complex: ResidentialComplex,
  ): SubscriptionStatus {
    return computeSubscriptionStatus(complex.subscriptionEndsAt);
  }

  @ResolveField(() => Int, {
    name: 'subscriptionDaysLeft',
    nullable: true,
    description: 'Días para vencer; 0 o negativo si ya venció',
  })
  subscriptionDaysLeft(@Parent() complex: ResidentialComplex): number | null {
    if (!complex.subscriptionEndsAt) return null;
    return daysUntil(new Date(complex.subscriptionEndsAt));
  }

  /**
   * Valor de la suscripción con su desglose, para las tarjetas del listado.
   * El complejo también lo leen residentes y portería: a ellos se les
   * devuelve vacío. Solo la plataforma ve lo que paga cada conjunto.
   */
  @ResolveField(() => SubscriptionQuote, {
    name: 'subscriptionQuote',
    nullable: true,
    description:
      'Valor de la suscripción del conjunto (subtotal, impuestos y total). Solo SUPER_ADMIN y cumplimiento; vacío para los demás.',
  })
  async subscriptionQuote(
    @Parent() complex: ResidentialComplex,
    @Context() context: { req?: { user?: { roles?: string[] } } },
  ): Promise<SubscriptionQuote | null> {
    const roles = context?.req?.user?.roles ?? [];
    if (!roles.some((role) => PRICE_VIEWERS.includes(role))) return null;
    return this.subscriptionsService.quoteFor(complex);
  }
}
