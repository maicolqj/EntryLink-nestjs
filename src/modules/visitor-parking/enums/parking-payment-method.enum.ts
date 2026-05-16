import { registerEnumType } from '@nestjs/graphql';

export enum ParkingPaymentMethod {
  CASH           = 'CASH',
  TRANSFER       = 'TRANSFER',
  CHARGE_TO_UNIT = 'CHARGE_TO_UNIT',
}

registerEnumType(ParkingPaymentMethod, {
  name: 'ParkingPaymentMethod',
  description: 'Método de pago del parqueadero visitante',
  valuesMap: {
    CASH:           { description: 'Efectivo' },
    TRANSFER:       { description: 'Transferencia bancaria / QR' },
    CHARGE_TO_UNIT: { description: 'Cargo a la cuenta de la unidad visitada' },
  },
});
