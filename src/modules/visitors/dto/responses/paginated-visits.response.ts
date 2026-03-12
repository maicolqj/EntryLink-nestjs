import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Visit } from '../../entities/visit.entity';

@ObjectType()
export class PaginatedVisitsResponse {

  @Field(() => [Visit])
  items: Visit[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
