import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Unit } from '../../entities/unit.entity';

@ObjectType()
export class PaginatedUnitsResponse {

  @Field(() => [Unit])
  items: Unit[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
