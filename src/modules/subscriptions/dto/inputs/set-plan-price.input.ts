import { Field, Float, InputType } from '@nestjs/graphql';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

import { ComplexPlan } from '../../../residential-complex/enums/complex-plan.enum';

@InputType({ description: 'Precio de un plan' })
export class SetPlanPriceInput {
  @Field(() => ComplexPlan)
  @IsEnum(ComplexPlan)
  plan: ComplexPlan;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  monthlyPrice: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Precio anual. Vacío = 10 mensualidades.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualPrice?: number | null;
}
