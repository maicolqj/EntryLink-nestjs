import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class RejectAccessRequestInput {

  @Field(() => String, { description: 'ID de la solicitud a rechazar' })
  @IsUUID()
  requestId: string;

  @Field(() => String, { nullable: true, description: 'Motivo del rechazo (visible para el supervisor)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
