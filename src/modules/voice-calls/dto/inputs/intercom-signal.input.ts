import { Field, InputType } from '@nestjs/graphql';
import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';

export const INTERCOM_SIGNAL_KINDS = ['offer', 'answer', 'candidate'] as const;
export type IntercomSignalKind = (typeof INTERCOM_SIGNAL_KINDS)[number];

/**
 * Señalización WebRTC: el servidor no la interpreta, solo se la pasa a la otra
 * parte de la llamada por socket.
 */
@InputType()
export class IntercomSignalInput {
  @Field(() => String)
  @IsUUID()
  callId: string;

  @Field(() => String, { description: 'offer | answer | candidate' })
  @IsIn(INTERCOM_SIGNAL_KINDS)
  kind: IntercomSignalKind;

  /** SDP o candidato ICE serializado en JSON. */
  @Field(() => String)
  @IsString()
  @MaxLength(20_000)
  payload: string;
}
