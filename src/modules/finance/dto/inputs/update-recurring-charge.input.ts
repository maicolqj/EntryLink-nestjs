import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsUUID, IsOptional, IsString, MaxLength, IsInt, Min, Max,
  IsBoolean, IsPositive, IsEnum, IsArray, ArrayUnique, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { FeeConfigBillingMode } from '../../enums/fee-config-billing-mode.enum';
import { RecurringChargeDistribution } from '../../enums/recurring-charge-distribution.enum';
import { RecurringChargeTrigger } from '../../enums/recurring-charge-trigger.enum';
import { FeeConfigTargetRulesInput } from './fee-config-target-rules.input';

/**
 * Actualiza un cobro recurrente. No permite cambiar el `type` (cambia la
 * prelación). Los cambios afectan las causaciones FUTURAS; los cargos ya
 * causados (FeeCharge) no se tocan.
 */
@InputType()
export class UpdateRecurringChargeInput {

  @Field()
  @IsUUID()
  id: string;

  @Field()
  @IsUUID()
  complexId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  concept?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsPositive()
  amount?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalInstallments?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  billingDay?: number;

  @Field(() => FeeConfigBillingMode, { nullable: true })
  @IsOptional()
  @IsEnum(FeeConfigBillingMode)
  billingMode?: FeeConfigBillingMode;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  incomeAccountId?: string;

  @Field(() => RecurringChargeDistribution, { nullable: true })
  @IsOptional()
  @IsEnum(RecurringChargeDistribution)
  distribution?: RecurringChargeDistribution;

  @Field(() => RecurringChargeTrigger, { nullable: true })
  @IsOptional()
  @IsEnum(RecurringChargeTrigger)
  triggerType?: RecurringChargeTrigger;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleTypes?: string[];

  @Field(() => FeeConfigTargetRulesInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeeConfigTargetRulesInput)
  targetRules?: FeeConfigTargetRulesInput;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetUnitIds?: string[];

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @Min(0)
  @Max(100)
  earlyDiscountPct?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  earlyDiscountDay?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
