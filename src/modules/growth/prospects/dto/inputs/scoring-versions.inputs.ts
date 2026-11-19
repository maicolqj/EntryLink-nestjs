import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import {
  GrowthProspectKind,
  GrowthScoringPredicate,
} from '../../prospects.enums';
import { GrowthScoringThresholdsInput } from './dedupe-scoring.inputs';

/** Una regla completa de un borrador (el borrador se reemplaza entero). */
@InputType()
export class GrowthScoringVersionRuleInput {
  @Field({ description: 'MAYÚSCULAS, números y _' })
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  key: string;

  @Field()
  @IsString()
  @Length(1, 120)
  label: string;

  @Field(() => GrowthScoringPredicate)
  @IsEnum(GrowthScoringPredicate)
  predicate: GrowthScoringPredicate;

  @Field(() => GraphQLJSON)
  @IsObject()
  params: Record<string, unknown>;

  @Field(() => Int)
  @IsInt()
  @Min(-100)
  @Max(100)
  points: number;

  @Field(() => [GrowthProspectKind])
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(GrowthProspectKind, { each: true })
  appliesTo: GrowthProspectKind[];

  @Field()
  @IsBoolean()
  active: boolean;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder: number;
}

@InputType()
export class GrowthCreateScoringDraftInput {
  @Field(() => ID, {
    nullable: true,
    description: 'Versión de partida; por defecto, la ACTIVE',
  })
  @IsOptional()
  @IsUUID()
  basedOnVersionId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

@InputType()
export class GrowthUpdateScoringDraftInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => [GrowthScoringVersionRuleInput], {
    nullable: true,
    description: 'Reemplaza todas las reglas del borrador',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GrowthScoringVersionRuleInput)
  rules?: GrowthScoringVersionRuleInput[];

  @Field(() => GrowthScoringThresholdsInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => GrowthScoringThresholdsInput)
  thresholds?: GrowthScoringThresholdsInput;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}
