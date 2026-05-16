import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumber, IsPositive, IsDateString, MaxLength,
} from 'class-validator';

import { PaymentMethod } from '../../enums/payment-method.enum';

/**
 * Pago masivo FIFO: aplica el monto recibido a los cargos pendientes/vencidos
 * más antiguos de la unidad, en orden ascendente de vencimiento.
 * Si sobra saldo después de pagar todos los cargos, se crea una entrada
 * de crédito en el wallet de la unidad.
 */
@InputType()
export class RegisterBulkPaymentInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  unitId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  /** Monto total a distribuir entre los cargos pendientes */
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
