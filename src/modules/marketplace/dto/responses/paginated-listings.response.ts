import { ObjectType, Field } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { MarketplaceListing } from '../../entities/marketplace-listing.entity';

@ObjectType()
export class PaginatedListingsResponse {
  @Field(() => [MarketplaceListing])
  items: MarketplaceListing[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
