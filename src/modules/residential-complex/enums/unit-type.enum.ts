import { registerEnumType } from '@nestjs/graphql';

export enum UnitType {
  APARTMENT   = 'APARTMENT',   // Apartamento estándar
  HOUSE       = 'HOUSE',       // Casa dentro de urbanización
  OFFICE      = 'OFFICE',      // Oficina
  STUDIO      = 'STUDIO',      // Estudio / monoambiente
  PENTHOUSE   = 'PENTHOUSE',   // Penthouse / ático
  COMMERCIAL  = 'COMMERCIAL',  // Local comercial
  WAREHOUSE   = 'WAREHOUSE',   // Bodega / depósito
}

registerEnumType(UnitType, {
  name: 'UnitType',
  description: 'Tipo de unidad dentro del complejo',
});
