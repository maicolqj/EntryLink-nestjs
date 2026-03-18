import { registerEnumType } from '@nestjs/graphql';

export enum PackageType {
  PARCEL       = 'PARCEL',        // Paquete / caja
  ENVELOPE     = 'ENVELOPE',      // Sobre / documento
  FOOD         = 'FOOD',          // Domicilio de comida
  FRAGILE      = 'FRAGILE',       // Frágil (cristal, electrónico)
  DOCUMENT     = 'DOCUMENT',      // Documentos legales / certificados
  OTHER        = 'OTHER',
}

registerEnumType(PackageType, {
  name: 'PackageType',
  description: 'Tipo / categoría del paquete recibido',
});
