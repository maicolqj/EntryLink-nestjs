import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Building } from '../../entities/building.entity';

@ObjectType()
export class PaginatedBuildingsResponse {

  @Field(() => [Building])
  items: Building[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
