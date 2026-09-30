import { registerEnumType } from '@nestjs/graphql';

/**
 * Lo que viene con una unidad aparte de la vivienda: su parqueadero propio y su
 * bodega. No confundir con el parqueadero que la rotación le asigna a cada
 * vehículo (`vehicles.parking_spot`): ese cambia; este es de la unidad.
 */
export enum UnitAssetType {
  PARKING = 'PARKING', // Parqueadero propio de la unidad
  STORAGE = 'STORAGE', // Bodega / depósito / cuarto útil
}

registerEnumType(UnitAssetType, {
  name: 'UnitAssetType',
  description: 'Parqueadero o bodega propia de una unidad',
  valuesMap: {
    PARKING: { description: 'Parqueadero propio de la unidad' },
    STORAGE: { description: 'Bodega o depósito de la unidad' },
  },
});
