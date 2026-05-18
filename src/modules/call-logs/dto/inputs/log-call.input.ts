import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsInt,
  Min,
  IsOptional,
  IsDateString,
  MaxLength,
} from 'class-validator';

import { CallDirection } from '../../enums/call-direction.enum';
import { CallOutcome }   from '../../enums/call-outcome.enum';

@InputType()
export class LogCallInput {

  @Field(() => String)
  @IsString() @IsNotEmpty()
  complexId: string;

  @Field(() => CallDirection)
  @IsEnum(CallDirection)
  direction: CallDirection;

  @Field(() => CallOutcome)
  @IsEnum(CallOutcome)
  outcome: CallOutcome;

  @Field(() => String)
  @IsString() @IsNotEmpty() @MaxLength(30)
  phoneNumber: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString()
  residentId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString() @MaxLength(200)
  residentName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString()
  unitId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString() @MaxLength(50)
  unitNumber?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString() @MaxLength(100)
  buildingName?: string;

  @Field(() => String)
  @IsDateString()
  startedAt: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsDateString()
  answeredAt?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsDateString()
  endedAt?: string;

  @Field(() => Int)
  @IsInt() @Min(0)
  durationSeconds: number;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString()
  notes?: string;
}
