import { registerEnumType } from '@nestjs/graphql';

export enum ParkingRecordStatus {
  OPEN            = 'OPEN',
  PAID            = 'PAID',
  CHARGED_TO_UNIT = 'CHARGED_TO_UNIT',
  CANCELLED       = 'CANCELLED',
}

registerEnumType(ParkingRecordStatus, {
  name: 'ParkingRecordStatus',
  description: 'Estado del registro de parqueadero visitante',
  valuesMap: {
    OPEN:            { description: 'Vehículo dentro del parqueadero, sin liquidar' },
    PAID:            { description: 'Cobro liquidado (efectivo o transferencia)' },
    CHARGED_TO_UNIT: { description: 'Cobro cargado a la cuenta de la unidad visitada' },
    CANCELLED:       { description: 'Registro anulado' },
  },
});
