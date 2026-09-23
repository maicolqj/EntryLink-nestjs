import { ObjectType, Field } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { MarketplaceContactPreference } from '../../enums/marketplace-contact-preference.enum';

/** Una persona del público de un aviso, tal como la lee la administración. */
@ObjectType({ description: 'Vecino que marcó me gusta o me interesa' })
export class ListingAudienceEntry {
  @Field(() => String)
  userId: string;

  @Field(() => String)
  name: string;

  @Field(() => String, { nullable: true })
  profilePicture?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Torre y unidad; nulo si ya no vive en el conjunto',
  })
  unitLabel?: string | null;

  @Field(() => Date, { description: 'Cuándo marcó me gusta o me interesa' })
  at: Date;

  @Field(() => String, {
    nullable: true,
    description: 'Mensaje que dejó el interesado',
  })
  message?: string | null;

  @Field(() => MarketplaceContactPreference, {
    nullable: true,
    description: 'Canal que usó el interesado',
  })
  channel?: MarketplaceContactPreference | null;
}

@ObjectType()
export class PaginatedListingAudienceResponse {
  @Field(() => [ListingAudienceEntry])
  items: ListingAudienceEntry[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
