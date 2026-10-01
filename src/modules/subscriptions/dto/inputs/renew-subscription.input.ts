import { Field, Float, ID, InputType } from '@nestjs/graphql';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ComplexPlan } from '../../../residential-complex/enums/complex-plan.enum';
import { BillingCycle } from '../../enums/billing-cycle.enum';

@InputType({ description: 'Registrar el pago de un periodo de suscripción' })
export class RenewSubscriptionInput {
  @Field(() => ID)
  @IsUUID()
  complexId: string;

  @Field(() => ComplexPlan, {
    description: 'Plan pagado. FREE no se puede pagar: es solo la prueba.',
  })
  @IsEnum(ComplexPlan)
  plan: ComplexPlan;

  @Field(() => BillingCycle)
  @IsEnum(BillingCycle)
  cycle: BillingCycle;

  @Field(() => Float, {
    nullable: true,
    description: 'Valor pagado. Vacío = el precio configurado del plan.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @Field(() => Date, {
    nullable: true,
    description: 'Fecha del pago. Vacío = ahora.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
