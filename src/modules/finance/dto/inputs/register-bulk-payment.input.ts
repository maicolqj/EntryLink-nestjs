
import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumber, IsPositive, IsDateString, MaxLength, Min,

} from 'class-validator';

import { PaymentMethod } from '../../enums/payment-method.enum';

@InputType()
export class RegisterBulkPaymentInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  unitId: string;

  /** Cargo del período actual — se paga primero */
  @Field()
  @IsString()
  @IsNotEmpty()
  baseChargeId: string;

  /**
   * Cantidad de meses adelantados a crear y pagar.
   * 0 = solo paga el cargo actual.
   */
  @Field(() => Int)
  @IsNumber()
  @Min(0)
  advanceMonths: number;

  /** Monto del cargo base y de cada mes adelantado */
  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  amount: number;

  @Field(() => PaymentMethod)
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

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
  @MaxLength(500)
  notes?: string;
}
