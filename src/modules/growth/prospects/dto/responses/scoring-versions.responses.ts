import { Field, Int, ObjectType } from '@nestjs/graphql';
import { PaginationReponse } from '../../../../shared/dto/responses/pagination-object.response';
import {
  ProspectScoreHistory,
  ScoringVersion,
} from '../../entities/scoring-version.entity';

/** Qué versión manda y cuántos puntajes faltan por ponerse al día. */
@ObjectType('GrowthScoringStatus')
export class GrowthScoringStatus {
  @Field(() => ScoringVersion)
  activeVersion: ScoringVersion;

  @Field(() => Int, {
    description: 'Puntajes calculados con la versión activa',
  })
  currentScores: number;

  @Field(() => Int, {
    description:
      'Puntajes calculados con otra versión: se recalculan en segundo plano',
  })
  staleScores: number;

  @Field(() => Int, {
    description: 'Prospectos que deberían tener puntaje y aún no lo tienen',
  })
  missingScores: number;
}

@ObjectType('PaginatedGrowthScoreHistory')
export class PaginatedGrowthScoreHistory {
  @Field(() => [ProspectScoreHistory])
  items: ProspectScoreHistory[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
