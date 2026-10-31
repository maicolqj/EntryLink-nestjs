import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import GraphQLJSON from 'graphql-type-json';
import {
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
import {
  GrowthDuplicateStatus,
  GrowthMergeSide,
  GrowthProspectKind,
  GrowthScoringPredicate,
} from '../../prospects.enums';

@InputType()
export class GrowthDuplicateFilterInput {
  @Field(() => GrowthProspectKind, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthProspectKind)
  entityType?: GrowthProspectKind;

  @Field(() => GrowthDuplicateStatus, {
    nullable: true,
    defaultValue: GrowthDuplicateStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(GrowthDuplicateStatus)
  status?: GrowthDuplicateStatus = GrowthDuplicateStatus.PENDING;
}

@InputType()
export class GrowthMergeFieldChoiceInput {
  @Field({ description: 'Campo en conflicto (p. ej. legalName, address)' })
  @Matches(/^[a-zA-Z]{2,40}$/)
  field: string;

  @Field(() => GrowthMergeSide)
  @IsEnum(GrowthMergeSide)
  side: GrowthMergeSide;
}

@InputType()
export class GrowthMergeDuplicatesInput {
  @Field(() => ID)
  @IsUUID()
  candidateId: string;

  @Field(() => ID, {
    description: 'Registro que se conserva (uno de los dos del par)',
  })
  @IsUUID()
  survivorId: string;

  @Field(() => [GrowthMergeFieldChoiceInput], {
    defaultValue: [],
    description:
      'Obligatorio para cada campo con valores distintos en ambos registros',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrowthMergeFieldChoiceInput)
  fieldChoices: GrowthMergeFieldChoiceInput[] = [];

  @Field({ description: 'Motivo de la fusión (queda en el historial)' })
  @IsString()
  @Length(5, 1000)
  note: string;
}

@InputType()
export class GrowthScoringRuleInput {
  @Field({ nullable: true, description: 'Solo al crear: MAYÚSCULAS_Y_GUIONES' })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  key?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 120)
  label?: string;

  @Field(() => GrowthScoringPredicate, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthScoringPredicate)
  predicate?: GrowthScoringPredicate;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-100)
  @Max(100)
  points?: number;

  @Field(() => [GrowthProspectKind], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(GrowthProspectKind, { each: true })
  appliesTo?: GrowthProspectKind[];

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

@InputType()
export class GrowthScoringThresholdsInput {
  @Field(() => Int, { description: 'Prioridad alta desde este puntaje' })
  @IsInt()
  @Min(1)
  @Max(100)
  high: number;

  @Field(() => Int, { description: 'Prioridad media desde este puntaje' })
  @IsInt()
  @Min(0)
  @Max(99)
  medium: number;
}
