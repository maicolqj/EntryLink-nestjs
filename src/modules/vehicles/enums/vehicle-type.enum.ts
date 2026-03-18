import { registerEnumType } from '@nestjs/graphql';

export enum VehicleType {
  CAR              = 'CAR',              // Automóvil
  MOTORCYCLE       = 'MOTORCYCLE',       // Motocicleta
  TRUCK            = 'TRUCK',            // Camioneta / camión
  VAN              = 'VAN',              // Van / furgoneta
  BICYCLE          = 'BICYCLE',          // Bicicleta (no ocupa parqueadero vehicular)
  ELECTRIC_SCOOTER = 'ELECTRIC_SCOOTER', // Patineta eléctrica
  OTHER            = 'OTHER',            // Otro
}

registerEnumType(VehicleType, {
  name: 'VehicleType',
  description: 'Tipo de vehículo registrado',
  valuesMap: {
    CAR:              { description: 'Automóvil / carro' },
    MOTORCYCLE:       { description: 'Motocicleta' },
    TRUCK:            { description: 'Camioneta o camión' },
    VAN:              { description: 'Van o furgoneta' },
    BICYCLE:          { description: 'Bicicleta (no ocupa parqueadero vehicular)' },
    ELECTRIC_SCOOTER: { description: 'Patineta eléctrica' },
    OTHER:            { description: 'Otro tipo de vehículo' },
  },
});
