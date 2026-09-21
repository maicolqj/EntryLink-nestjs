import { registerEnumType } from '@nestjs/graphql';

export enum IncomeCategory {
  PARKING = 'PARKING', // Parqueadero de visitantes
  HALL_RENTAL = 'HALL_RENTAL', // Alquiler de zona social. El valor se queda:
  // renombrarlo obligaría a migrar el enum nativo y reescribir lo ya registrado.
  FINES = 'FINES', // Multas y sanciones
  INTEREST = 'INTEREST', // Rendimientos financieros
  SALE = 'SALE', // Venta de activos / chatarra
  DONATION = 'DONATION', // Donaciones y aportes
  OTHER = 'OTHER', // Otros ingresos
}

registerEnumType(IncomeCategory, {
  name: 'IncomeCategory',
  description: 'Categoría de ingreso directo (caja/banco) del complejo',
  valuesMap: {
    PARKING: { description: 'Parqueadero de visitantes' },
    HALL_RENTAL: { description: 'Alquiler de zona social' },
    FINES: { description: 'Multas y sanciones' },
    INTEREST: { description: 'Rendimientos financieros' },
    SALE: { description: 'Venta de activos' },
    DONATION: { description: 'Donaciones y aportes' },
    OTHER: { description: 'Otros ingresos' },
  },
});
