import { registerEnumType } from '@nestjs/graphql';

export enum ComplexType {
  APARTMENT_COMPLEX = 'APARTMENT_COMPLEX', // Conjunto de apartamentos
  HOUSES_COMMUNITY  = 'HOUSES_COMMUNITY',  // Urbanización de casas
  // OFFICE_BUILDING   = 'OFFICE_BUILDING',   // Edificio de oficinas
  MIXED_COMPLEX     = 'MIXED_COMPLEX',     // Uso mixto (aptos + casas)
  // MIXED             = 'MIXED',             // Uso mixto (aptos + comercio)
}

registerEnumType(ComplexType, {
  name: 'ComplexType',
  description: 'Tipo de complejo residencial',
  valuesMap: {
    APARTMENT_COMPLEX: { description: 'Conjunto cerrado de apartamentos' },
    HOUSES_COMMUNITY:  { description: 'Urbanización de casas' },
    // OFFICE_BUILDING:   { description: 'Edificio de oficinas o comercial' },
    MIXED_COMPLEX:     { description: 'Uso mixto residencial apartamentos y casas' },
    // MIXED:             { description: 'Uso mixto residencial y comercial' },
  },
}); 