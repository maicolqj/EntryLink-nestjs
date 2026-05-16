import { registerEnumType } from '@nestjs/graphql';

export enum CallOutcome {
  ANSWERED = 'ANSWERED',
  MISSED   = 'MISSED',
  REJECTED = 'REJECTED',
  FAILED   = 'FAILED',
}

registerEnumType(CallOutcome, {
  name: 'CallOutcome',
  description: 'Resultado de la llamada',
});
