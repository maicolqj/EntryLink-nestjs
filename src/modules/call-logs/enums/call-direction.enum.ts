import { registerEnumType } from '@nestjs/graphql';

export enum CallDirection {
  OUTGOING = 'OUTGOING',
  INCOMING = 'INCOMING',
}

registerEnumType(CallDirection, {
  name: 'CallDirection',
  description: 'Dirección de la llamada',
});
