import { registerEnumType } from '@nestjs/graphql';

export enum MessageChannel {
  SMS       = 'SMS',
  WHATSAPP  = 'WHATSAPP',
}

registerEnumType(MessageChannel, {
  name: 'MessageChannel',
  description: 'Canal por el que se envió el mensaje',
});
