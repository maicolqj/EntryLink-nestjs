import { Field, Int, ObjectType } from '@nestjs/graphql';
import { PaginationReponse } from '../../../../shared/dto/responses/pagination-object.response';
import { Suppression } from '../../entities/suppression.entity';

@ObjectType('PaginatedGrowthSuppressions')
export class PaginatedGrowthSuppressionsResponse {
  @Field(() => [Suppression])
  items: Suppression[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

/** Estado del llavero HMAC frente a las exclusiones activas. */
@ObjectType('GrowthSuppressionKeyStatus')
export class GrowthSuppressionKeyStatus {
  @Field(() => Int)
  activeVersion: number;

  @Field(() => [Int])
  configuredVersions: number[];

  @Field(() => Int)
  activeSuppressions: number;

  @Field(() => Int, {
    description:
      'Exclusiones activas sin hash en la versión activa (se completan al consultarse)',
  })
  missingActiveVersion: number;

  @Field(() => Int, {
    description:
      'Exclusiones activas sin hash en NINGUNA versión configurada. Debe ser 0.',
  })
  uncovered: number;

  @Field(() => [Int], {
    description: 'Versiones viejas que ya se pueden quitar del llavero',
  })
  retirableVersions: number[];
}
