import { ObjectType, Field } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { MarketplaceListingReport } from '../../entities/marketplace-listing-report.entity';

@ObjectType()
export class PaginatedListingReportsResponse {
  @Field(() => [MarketplaceListingReport])
  items: MarketplaceListingReport[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
