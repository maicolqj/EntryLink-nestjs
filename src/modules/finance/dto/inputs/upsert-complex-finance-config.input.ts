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
}
