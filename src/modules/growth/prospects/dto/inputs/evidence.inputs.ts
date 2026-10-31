import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GrowthEntityType } from '../../../shared/growth.enums';
import { GrowthEvidenceStatus } from '../../prospects.enums';
import { GrowthSourceReferenceInput } from './source-reference.input';

@InputType()
export class GrowthAddEvidenceInput {
  @Field(() => GrowthEntityType)
  @IsEnum(GrowthEntityType)
  entityType: GrowthEntityType;

  @Field(() => ID)
  @IsUUID()
  entityId: string;

  @Field({ description: 'Campo que respalda (p. ej. legalName, nit, address)' })
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{1,59}$/)
  field: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  observedValue?: string;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

@InputType()
export class GrowthVerifyEvidenceInput {
  @Field(() => GrowthEvidenceStatus, { description: 'VERIFIED o DISPUTED' })
  @IsIn([GrowthEvidenceStatus.VERIFIED, GrowthEvidenceStatus.DISPUTED])
  status: GrowthEvidenceStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}
