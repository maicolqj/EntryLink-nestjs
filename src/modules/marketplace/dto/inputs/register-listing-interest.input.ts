import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class RegisterListingInterestInput {
  @Field(() => String)
  @IsUUID()
  listingId: string;

  @Field(() => String, {
    nullable: true,
    description: 'Mensaje corto para el publicador',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
