import { registerEnumType } from '@nestjs/graphql';

/** Tipo de zona común. Determina el ícono y los textos por defecto en la app. */
export enum AmenityType {
  SALON_COMUNAL   = 'SALON_COMUNAL',
  ZONA_BBQ        = 'ZONA_BBQ',
  PISCINA         = 'PISCINA',
  GIMNASIO        = 'GIMNASIO',
  CANCHA          = 'CANCHA',
  COWORKING       = 'COWORKING',
  SAUNA           = 'SAUNA',
  TERRAZA         = 'TERRAZA',
  PARQUE_INFANTIL = 'PARQUE_INFANTIL',
  TEATRINO        = 'TEATRINO',
  OTRO            = 'OTRO',
}

registerEnumType(AmenityType, {
  name: 'AmenityType',
  description: 'Tipo de zona común del complejo residencial',
});
