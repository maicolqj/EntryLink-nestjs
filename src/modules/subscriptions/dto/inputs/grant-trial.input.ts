import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { FreePeriodReason } from '../../enums/free-period-reason.enum';

@InputType({
  description:
    'Otorgar días gratis: la prueba (una vez) o una cortesía (recomendación, promoción…)',
})
export class GrantTrialInput {
  @Field(() => ID)
  @IsUUID()
  complexId: string;

  @Field(() => Int, {
    nullable: true,
    description: 'Días gratis (1 a 365). Vacío = 30.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @Field(() => FreePeriodReason, {
    nullable: true,
    description: 'Vacío = TRIAL (la prueba gratis)',
  })
  @IsOptional()
  @IsEnum(FreePeriodReason)
  reason?: FreePeriodReason;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
