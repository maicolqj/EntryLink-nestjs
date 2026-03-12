import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

@InputType()
export class BlacklistVisitorInput {

  @Field(() => String, { description: 'ID del visitante a bloquear' })
  @IsUUID()
  visitorId: string;

  @Field(() => String, { description: 'Razón del bloqueo (obligatoria)' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
