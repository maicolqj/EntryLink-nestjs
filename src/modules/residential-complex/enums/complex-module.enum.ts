import { registerEnumType } from '@nestjs/graphql';

export enum ComplexModule {
  EDIFICIOS      = 'EDIFICIOS',
  UNIDADES       = 'UNIDADES',
  RESIDENTES     = 'RESIDENTES',
  VISITAS        = 'VISITAS',
  VEHICULOS      = 'VEHICULOS',
  PAQUETES       = 'PAQUETES',
  FINANZAS       = 'FINANZAS',
  NOTAS          = 'NOTAS',
  PERSONAL       = 'PERSONAL',
  MENSAJES       = 'MENSAJES',
  MOVIMIENTOS    = 'MOVIMIENTOS',
  NOTIFICACIONES = 'NOTIFICACIONES',
  PARKING_ROTATION     = 'PARKING_ROTATION',
  PARKING_BILLING     = 'PARKING_BILLING',
} 

registerEnumType(ComplexModule, {
  name: 'ComplexModule',
  description: 'Módulos funcionales disponibles para un complejo residencial',
});
