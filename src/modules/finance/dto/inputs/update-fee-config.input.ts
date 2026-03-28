import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumber, Min, Max, IsPositive, MaxLength, IsBoolean, IsInt,
} from 'class-validator';

import { FeeFrequency } from '../../enums/fee-frequency.enum';
import { ChargeType }   from '../../enums/charge-type.enum';

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
}
