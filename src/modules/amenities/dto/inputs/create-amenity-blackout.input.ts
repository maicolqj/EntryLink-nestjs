import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsDateString, IsString, IsNotEmpty, MaxLength } from 'class-validator';

@InputType()
export class CreateAmenityBlackoutInput {

  @Field()
  @IsUUID()
  amenityId: string;

  @Field(() => String, { description: 'Inicio del bloqueo (ISO 8601)' })
  @IsDateString()
  startAt: string;

  @Field(() => String, { description: 'Fin del bloqueo (ISO 8601)' })
  @IsDateString()
  endAt: string;

  @Field(() => String, { description: 'Motivo visible para el residente' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}
