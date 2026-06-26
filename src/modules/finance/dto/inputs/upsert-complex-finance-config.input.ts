import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsBoolean,
  IsNumber, IsPositive, Min, Max,
} from 'class-validator';

@InputType()
export class UpsertComplexFinanceConfigInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  /**
   * Tasa mensual de mora en % (ej. 2.0 = 2%).
   * Rango válido: 0.01 – 100.
   */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(100)
  moraRate?: number;

  /**
   * Días de gracia antes de aplicar mora (0 = sin gracia).
   */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  moraGraceDays?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  autoApplyMora?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  autoGenerateCharges?: boolean;

  /** Descuento por pronto pago en % (0 = sin descuento). */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  earlyDiscountPct?: number;

  /** Día del mes (1-31) hasta el cual aplica el pronto pago. 31 = último día. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(31)
  earlyDiscountDay?: number;
}
