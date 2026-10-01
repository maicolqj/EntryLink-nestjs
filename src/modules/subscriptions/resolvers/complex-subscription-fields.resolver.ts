import { Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import {
  computeSubscriptionStatus,
  daysUntil,
} from '../utils/subscription-status';

/**
 * Estado de la suscripción en el propio complejo, para el listado del
 * SUPER_ADMIN ("Vence") y el banner del panel. Se calcula al vuelo desde
 * `subscriptionEndsAt`: guardarlo dejaría el estado viejo hasta que corriera
 * algún proceso.
 */
@Resolver(() => ResidentialComplex)
export class ComplexSubscriptionFieldsResolver {
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
}
