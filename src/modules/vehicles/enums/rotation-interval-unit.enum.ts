import { registerEnumType } from '@nestjs/graphql';

export enum RotationIntervalUnit {
  DAYS   = 'DAYS',
  WEEKS  = 'WEEKS',
  MONTHS = 'MONTHS',
}

registerEnumType(RotationIntervalUnit, {
  name: 'RotationIntervalUnit',
  description: 'Unidad de tiempo para el intervalo de rotación de parqueaderos',
  valuesMap: {
    DAYS:   { description: 'Días (ej: cada 30 días)' },
    WEEKS:  { description: 'Semanas (ej: cada 2 semanas)' },
    MONTHS: { description: 'Meses (ej: cada 3 meses)' },
  },
});
