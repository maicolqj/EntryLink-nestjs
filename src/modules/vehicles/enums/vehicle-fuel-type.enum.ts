import { registerEnumType } from '@nestjs/graphql';

export enum VehicleFuelType {
  GASOLINE = 'GASOLINE', // Gasolina
  DIESEL   = 'DIESEL',   // Diésel
  GAS      = 'GAS',      // Gas natural / GNV
  ELECTRIC = 'ELECTRIC', // Eléctrico
  HYBRID   = 'HYBRID',   // Híbrido
  OTHER    = 'OTHER',    // Otro
}

registerEnumType(VehicleFuelType, {
  name: 'VehicleFuelType',
  description: 'Tipo de combustible del vehículo',
});
