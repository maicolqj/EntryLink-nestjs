import { registerEnumType } from '@nestjs/graphql';

export enum ParkingRateType {
  PER_MINUTE = 'PER_MINUTE',
  PER_HOUR   = 'PER_HOUR',
  DAILY      = 'DAILY',
  FIXED      = 'FIXED',
  EVENT      = 'EVENT',
}

registerEnumType(ParkingRateType, {
  name: 'ParkingRateType',
  description: 'Tipo de tarifa aplicada en el parqueadero',
  valuesMap: {
    PER_MINUTE: { description: 'Cobro por minuto' },
    PER_HOUR:   { description: 'Cobro por hora (se redondea al alza)' },
    DAILY:      { description: 'Cobro por día (se redondea al alza)' },
    FIXED:      { description: 'Tarifa fija independiente del tiempo' },
    EVENT:      { description: 'Tarifa especial de evento' },
  },
});
