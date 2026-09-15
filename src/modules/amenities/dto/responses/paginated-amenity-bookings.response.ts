import { ObjectType, Field } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { AmenityBooking } from '../../entities/amenity-booking.entity';

@ObjectType()
export class PaginatedAmenityBookingsResponse {
  @Field(() => [AmenityBooking])
  items: AmenityBooking[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
