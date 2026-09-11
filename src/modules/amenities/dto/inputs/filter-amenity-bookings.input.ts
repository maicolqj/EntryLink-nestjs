import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';

import { AmenityBookingStatus } from '../../enums/amenity-booking-status.enum';

@InputType()
export class FilterAmenityBookingsInput {

  @Field(() => AmenityBookingStatus, { nullable: true })
  @IsOptional()
  @IsEnum(AmenityBookingStatus)
  status?: AmenityBookingStatus;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  amenityId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => String, { nullable: true, description: 'Reservas que inician desde esta fecha (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startFrom?: string;

  @Field(() => String, { nullable: true, description: 'Reservas que inician hasta esta fecha (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startUntil?: string;
}
