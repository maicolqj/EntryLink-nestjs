import { registerEnumType } from '@nestjs/graphql';

export enum ComplexType {
  APARTMENT_COMPLEX = 'APARTMENT_COMPLEX', // Conjunto de apartamentos
  HOUSES_COMMUNITY  = 'HOUSES_COMMUNITY',  // Urbanización de casas
  OFFICE_BUILDING   = 'OFFICE_BUILDING',   // Edificio de oficinas
  MIXED             = 'MIXED',             // Uso mixto (aptos + comercio)
}

registerEnumType(ComplexType, {
  name: 'ComplexType',
  description: 'Tipo de complejo residencial',
  valuesMap: {
    APARTMENT_COMPLEX: { description: 'Conjunto cerrado de apartamentos' },
    HOUSES_COMMUNITY:  { description: 'Urbanización de casas' },
    OFFICE_BUILDING:   { description: 'Edificio de oficinas o comercial' },
    MIXED:             { description: 'Uso mixto residencial y comercial' },
  },
});
