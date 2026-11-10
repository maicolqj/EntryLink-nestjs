import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class AnswerIntercomCallInput {
  @Field(() => String)
  @IsUUID()
  callId: string;

  /**
   * Identificador del equipo que contesta. Viaja en el aviso de "contestada"
   * para que los otros equipos de la misma cuenta dejen de sonar y este no.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string;
}
