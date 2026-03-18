import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumber, IsPositive, IsDateString, MaxLength,
} from 'class-validator';

import { PaymentMethod } from '../../enums/payment-method.enum';

@InputType()
export class RegisterPaymentInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  chargeId: string;

  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  amount: number;

  @Field(() => PaymentMethod)
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /** Fecha real del pago (puede ser diferente a hoy si es un pago retroactivo) */
  @Field()
  @IsDateString()
  paidAt: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
