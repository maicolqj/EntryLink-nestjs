import { Field, Float, ObjectType } from '@nestjs/graphql';

import { BillingCycle } from '../../enums/billing-cycle.enum';
import { SubscriptionPricingMode } from '../../enums/subscription-pricing-mode.enum';

@ObjectType({ description: 'Cómo se le cobra a un conjunto' })
export class SubscriptionPricing {
  @Field(() => SubscriptionPricingMode)
  mode: SubscriptionPricingMode;

  @Field(() => Float, {
    nullable: true,
    description:
      'Valor por unidad (PER_UNIT) o valor mensual fijo (FIXED), antes de impuestos',
  })
  price?: number | null;

  @Field(() => BillingCycle)
  cycle: BillingCycle;
}
