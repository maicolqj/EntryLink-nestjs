import { registerEnumType } from '@nestjs/graphql';

export enum ParkingStatus {
  INSIDE    = 'INSIDE',
  EXITED    = 'EXITED',
  CANCELLED = 'CANCELLED',
}

registerEnumType(ParkingStatus, {
  name: 'ParkingStatus',
  description: 'Estado del vehículo visitante en el parqueadero',
  valuesMap: {
    INSIDE:    { description: 'Vehículo actualmente en el parqueadero' },
    EXITED:    { description: 'Vehículo que ya salió (cobro generado)' },
    CANCELLED: { description: 'Registro cancelado manualmente' },
  },
});
