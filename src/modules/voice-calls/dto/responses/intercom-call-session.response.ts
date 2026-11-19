import { Field, ObjectType } from '@nestjs/graphql';

import { CallLog } from '../../../call-logs/entities/call-log.entity';
import { IceServer } from './ice-server.response';

/** Lo que necesita un equipo para entrar a la llamada. */
@ObjectType()
export class IntercomCallSession {
  @Field(() => CallLog)
  call: CallLog;

  @Field(() => [IceServer], {
    description: 'Servidores STUN/TURN con credenciales temporales',
  })
  iceServers: IceServer[];
}
