import { registerEnumType } from '@nestjs/graphql';

export enum VisitorIdentityType {
  CC         = 'CC',         // Cédula de Ciudadanía
  CE         = 'CE',         // Cédula de Extranjería
  PASSPORT   = 'PASSPORT',   // Pasaporte
  TI         = 'TI',         // Tarjeta de Identidad
  FOREIGN_ID = 'FOREIGN_ID', // Documento extranjero
  OTHER      = 'OTHER',      // Otro
}

registerEnumType(VisitorIdentityType, {
  name: 'VisitorIdentityType',
  description: 'Tipo de documento de identidad del visitante',
});
