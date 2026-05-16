import { registerEnumType } from '@nestjs/graphql';

export enum MessageType {
  COMUNICADO   = 'COMUNICADO',
  ALERTA       = 'ALERTA',
  INFORMATIVO  = 'INFORMATIVO',
  URGENTE      = 'URGENTE',
  RECORDATORIO = 'RECORDATORIO',
}

registerEnumType(MessageType, {
  name: 'MessageType',
  description: 'Tipo/categoría del mensaje enviado',
});
