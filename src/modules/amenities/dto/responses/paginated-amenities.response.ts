import { ObjectType, Field } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Amenity } from '../../entities/amenity.entity';

@ObjectType()
export class PaginatedAmenitiesResponse {
  @Field(() => [Amenity])
  items: Amenity[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
