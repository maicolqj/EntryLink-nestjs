import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsNumber, IsPositive,
  IsArray, ArrayNotEmpty, Matches, MaxLength,
} from 'class-validator';

@InputType()
export class CreateDirectChargesInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field(() => [String])
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  unitIds: string[];

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description: string;

  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  amount: number;

  /** Período de facturación en formato YYYY-MM (ej. "2025-03") */
  @Field()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El período debe tener el formato YYYY-MM (ej. 2025-03)',
  })
  period: string;
}
