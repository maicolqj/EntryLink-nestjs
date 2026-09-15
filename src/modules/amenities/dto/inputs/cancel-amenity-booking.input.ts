import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class CancelAmenityBookingInput {
  @Field()
  @IsUUID()
  bookingId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
