import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Visitor } from '../../entities/visitor.entity';

@ObjectType()
export class PaginatedVisitorsResponse {

  @Field(() => [Visitor])
  items: Visitor[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
