import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

import { BillingCycle } from '../../enums/billing-cycle.enum';
import { SubscriptionPricingMode } from '../../enums/subscription-pricing-mode.enum';

@InputType({ description: 'Cómo se le cobra a un conjunto' })
export class SetComplexPricingInput {
  @Field(() => ID)
  @IsUUID()
  complexId: string;

  @Field(() => SubscriptionPricingMode)
  @IsEnum(SubscriptionPricingMode)
  mode: SubscriptionPricingMode;

  @Field(() => Float, {
    nullable: true,
    description:
      'Valor por unidad (PER_UNIT) o valor mensual fijo (FIXED), antes de impuestos. No aplica a PLAN.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number | null;

  @Field(() => BillingCycle)
  @IsEnum(BillingCycle)
  cycle: BillingCycle;
}
