import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { GrowthScoreItem } from '../../entities/dedupe-scoring.entity';
import { GrowthPriority, GrowthProspectKind } from '../../prospects.enums';

@ObjectType('GrowthScoringDistribution')
export class GrowthScoringDistribution {
  @Field(() => Int) high: number;
  @Field(() => Int) medium: number;
  @Field(() => Int) low: number;

  @Field(() => Float, { description: 'Promedio del puntaje, 0–100' })
  averageScore: number;

  @Field(() => Int, { description: 'Umbral de prioridad alta usado' })
  highThreshold: number;

  @Field(() => Int, { description: 'Umbral de prioridad media usado' })
  mediumThreshold: number;
}

@ObjectType('GrowthScoringTransition')
export class GrowthScoringTransition {
  @Field(() => GrowthPriority) from: GrowthPriority;
  @Field(() => GrowthPriority) to: GrowthPriority;
  @Field(() => Int) count: number;
}

@ObjectType('GrowthScoringSimulationItem')
export class GrowthScoringSimulationItem {
  @Field(() => GrowthProspectKind) kind: GrowthProspectKind;
  @Field(() => ID) id: string;
  @Field() displayName: string;
  @Field(() => Int) currentScore: number;
  @Field(() => Int) proposedScore: number;
  @Field(() => Int, { description: 'proposedScore − currentScore' })
  delta: number;
  @Field(() => GrowthPriority) currentPriority: GrowthPriority;
  @Field(() => GrowthPriority) proposedPriority: GrowthPriority;
  @Field(() => [GrowthScoreItem]) currentBreakdown: GrowthScoreItem[];
  @Field(() => [GrowthScoreItem]) proposedBreakdown: GrowthScoreItem[];
}

@ObjectType('GrowthScoringSimulation', {
  description:
    'Comparación entre la configuración vigente y la propuesta, calculada con el mismo motor sobre los datos actuales. No guarda nada.',
})
export class GrowthScoringSimulation {
  @Field(() => Int, {
    description:
      'Versión vigente del scoring sobre la que se simuló. Si cambia antes de guardar, conviene volver a simular.',
  })
  scoringVersion: number;

  @Field(() => Int, {
    description:
      'Prospectos con puntaje: empresas y administradores independientes vigentes',
  })
  evaluated: number;

  @Field(() => Int) changedScore: number;
  @Field(() => Int) changedPriority: number;

  @Field(() => GrowthScoringDistribution) current: GrowthScoringDistribution;
  @Field(() => GrowthScoringDistribution) proposed: GrowthScoringDistribution;

  @Field(() => [GrowthScoringTransition], {
    description: 'Prioridad vigente → propuesta, solo pares con prospectos',
  })
  transitions: GrowthScoringTransition[];

  @Field(() => [GrowthScoringSimulationItem], {
    description:
      'Prospectos con cambio de puntaje o prioridad, mayor variación primero. Vacío sin VIEW_ALL_GROWTH_PROSPECTS (ver itemsHidden).',
  })
  items: GrowthScoringSimulationItem[];

  @Field({
    description:
      'true si el usuario no puede ver todos los prospectos: recibe solo los agregados',
  })
  itemsHidden: boolean;
}
