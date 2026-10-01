import { Field, Float, ObjectType } from '@nestjs/graphql';

import { ComplexPlan } from '../../../residential-complex/enums/complex-plan.enum';

@ObjectType({ description: 'Precio vigente de un plan' })
export class SubscriptionPlanPriceView {
  @Field(() => ComplexPlan)
  plan: ComplexPlan;

  @Field(() => Float)
  monthlyPrice: number;

  @Field(() => Float, { description: 'Precio anual efectivo' })
  annualPrice: number;

  @Field(() => Boolean, {
    description: 'true si el anual se fijó a mano; false = 10 mensualidades',
  })
  annualPriceIsCustom: boolean;

  @Field(() => Date, { nullable: true })
  updatedAt?: Date | null;
}
