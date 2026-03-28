import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsNumber, IsPositive, Matches,
} from 'class-validator';

@InputType()
export class CreateWalletCreditInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  unitId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  amount: number;

  @Field()
  @IsString()
  @IsNotEmpty()
  description: string;
}

@InputType()
export class ApplyWalletToChargeInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  unitId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  chargeId: string;


  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  amount: number;
}

@InputType()
export class ApplyMoraInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  /** Período de referencia del corte en formato YYYY-MM */
  @Field()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El período debe tener el formato YYYY-MM (ej. 2025-03)',
  })
  period: string;

  /** Tasa mensual en % (ej. 2 = 2%) */
  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  rate: number;

  /** Días de gracia antes de calcular mora */
  @Field(() => Float)
  @IsNumber()
  graceDays: number;
}
