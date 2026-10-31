import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { GrowthEntityType } from '../../../shared/growth.enums';

@InputType()
export class GrowthCreateLegalHoldInput {
  @Field(() => GrowthEntityType)
  @IsEnum(GrowthEntityType)
  entityType: GrowthEntityType;

  @Field(() => ID)
  @IsUUID()
  entityId: string;

  @Field({ description: 'Norma u obligación que justifica conservar' })
  @IsString()
  @Length(10, 2000)
  legalBasis: string;

  @Field({ description: 'YYYY-MM-DD. Posterior a hoy y a lo sumo 10 años.' })
  @IsISO8601({ strict: true })
  holdUntil: string;
}

@InputType()
export class GrowthReleaseLegalHoldInput {
  @Field()
  @IsString()
  @Length(10, 2000)
  reason: string;
}

@InputType()
export class GrowthLegalHoldFilterInput {
  @Field({ nullable: true, description: 'true = solo las vigentes' })
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}
