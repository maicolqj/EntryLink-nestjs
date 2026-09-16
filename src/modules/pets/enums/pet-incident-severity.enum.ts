import { registerEnumType } from '@nestjs/graphql';

export enum PetIncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

registerEnumType(PetIncidentSeverity, {
  name: 'PetIncidentSeverity',
  description: 'Gravedad del incidente reportado',
  valuesMap: {
    LOW: { description: 'Falta leve' },
    MEDIUM: { description: 'Falta reiterada o con molestia a terceros' },
    HIGH: { description: 'Riesgo para personas o animales' },
  },
});
