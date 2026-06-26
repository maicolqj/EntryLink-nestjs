import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsUUID, Matches,
  MaxLength, IsInt, Min, Max, IsEnum, IsArray, ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { FeeConfigBillingMode } from '../../enums/fee-config-billing-mode.enum';
import { ChargeRuleInput }      from './charge-rule.input';

@InputType()
export class CreateChargeEmissionInput {

  @Field()
  @IsUUID()
  complexId: string;

  @Field({ description: 'Nombre del concepto. Ej: "Cuota de Administración"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  conceptName: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Field({ description: 'Período de facturación YYYY-MM' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El período debe tener el formato YYYY-MM (ej. 2025-03)',
  })
  period: string;

  @Field(() => Int, { defaultValue: 5, description: 'Día del mes de vencimiento (1-28)' })
  @IsInt()
  @Min(1)
  @Max(28)
  dueDayOfMonth: number;

  @Field(() => FeeConfigBillingMode, { defaultValue: FeeConfigBillingMode.ADVANCE })
  @IsOptional()
  @IsEnum(FeeConfigBillingMode)
  billingMode?: FeeConfigBillingMode;

  @Field(() => [ChargeRuleInput])
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ChargeRuleInput)
  rules: ChargeRuleInput[];
}
