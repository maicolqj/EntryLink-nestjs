import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumber, Min, Max, IsPositive, MaxLength, IsBoolean, IsInt, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { FeeFrequency } from '../../enums/fee-frequency.enum';
import { ChargeType }   from '../../enums/charge-type.enum';
import { FeeConfigBillingMode } from '../../enums/fee-config-billing-mode.enum';
import { FeeConfigTriggerType } from '../../enums/fee-config-trigger-type.enum';
import { FeeConfigTargetRulesInput } from './fee-config-target-rules.input';

@InputType()
export class UpdateFeeConfigInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  earlyPaymentAmount?: number;

  /** Día del mes en que vence el pronto pago. Si null, usa dueDayOfMonth. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  earlyPaymentDueDayOfMonth?: number;

  @Field(() => FeeFrequency, { nullable: true })
  @IsOptional()
  @IsEnum(FeeFrequency)
  frequency?: FeeFrequency;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(28)
  dueDayOfMonth?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => ChargeType, { nullable: true })
  @IsOptional()
  @IsEnum(ChargeType)
  chargeType?: ChargeType;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;

  @Field(() => FeeConfigBillingMode, { nullable: true })
  @IsOptional()
  @IsEnum(FeeConfigBillingMode)
  billingMode?: FeeConfigBillingMode;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @Field(() => FeeConfigTargetRulesInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeeConfigTargetRulesInput)
  targetRules?: FeeConfigTargetRulesInput | null;

  @Field(() => FeeConfigTriggerType, { nullable: true })
  @IsOptional()
  @IsEnum(FeeConfigTriggerType)
  triggerType?: FeeConfigTriggerType | null;
}
