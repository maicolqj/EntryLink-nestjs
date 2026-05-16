import { registerEnumType } from '@nestjs/graphql';

export enum SupervisorVisitStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

registerEnumType(SupervisorVisitStatus, {
  name: 'SupervisorVisitStatus',
  description: 'Estado de la visita del supervisor al complejo residencial',
});
