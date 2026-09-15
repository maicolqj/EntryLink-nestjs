import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsString, IsNotEmpty, MaxLength } from 'class-validator';

@InputType()
export class RejectAmenityBookingInput {
  @Field()
  @IsUUID()
  bookingId: string;

  @Field(() => String, {
    description:
      'Motivo del rechazo. Obligatorio: el residente debe saber por qué',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}
