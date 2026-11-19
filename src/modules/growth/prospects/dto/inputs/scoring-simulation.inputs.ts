import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  GrowthScoringRuleInput,
  GrowthScoringThresholdsInput,
} from './dedupe-scoring.inputs';

@InputType()
export class GrowthScoringRuleChangeInput extends GrowthScoringRuleInput {
  @Field(() => ID, {
    nullable: true,
    description:
      'Regla existente a modificar. Sin ruleId es una regla nueva (exige key, label, predicate, points y appliesTo).',
  })
  @IsOptional()
  @IsUUID()
  ruleId?: string;
}

@InputType()
export class GrowthScoringSimulationInput {
  @Field(() => [GrowthScoringRuleChangeInput], {
    defaultValue: [],
    description:
      'Cambios sobre las reglas vigentes; desactivar = active: false',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GrowthScoringRuleChangeInput)
  ruleChanges: GrowthScoringRuleChangeInput[] = [];

  @Field(() => GrowthScoringThresholdsInput, {
    nullable: true,
    description: 'Umbrales propuestos; sin ellos se usan los vigentes',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GrowthScoringThresholdsInput)
  thresholds?: GrowthScoringThresholdsInput;

  @Field(() => Int, {
    defaultValue: 25,
    description:
      'Cuántos prospectos con cambios listar (mayor variación primero). Máximo 100.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  sampleLimit: number = 25;
}
