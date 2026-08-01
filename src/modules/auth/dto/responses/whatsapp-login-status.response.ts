import { ObjectType, Field } from '@nestjs/graphql';
import { WhatsAppLoginStatus } from '../../enums/whatsapp-login-status.enum';

@ObjectType({ description: 'Estado de un intento de login por WhatsApp entrante' })
export class WhatsAppLoginStatusResponse {
  @Field(() => WhatsAppLoginStatus, {
    description: 'PENDING mientras no llega el mensaje; CONFIRMED habilita el canje',
  })
  status: WhatsAppLoginStatus;

  @Field(() => Date)
  expiresAt: Date;
}
