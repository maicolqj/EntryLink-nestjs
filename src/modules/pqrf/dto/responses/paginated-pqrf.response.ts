import { ObjectType, Field } from '@nestjs/graphql';

import { Pqrf } from '../../entities/pqrf.entity';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';

@ObjectType({ description: 'Radicados PQRF paginados' })
export class PaginatedPqrfResponse {

  @Field(() => [Pqrf])
  items: Pqrf[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
