import { registerEnumType } from '@nestjs/graphql';

export enum FeeFrequency {
  MONTHLY    = 'MONTHLY',
  BIMONTHLY  = 'BIMONTHLY',   // Cada 2 meses
  QUARTERLY  = 'QUARTERLY',   // Trimestral
  SEMIANNUAL = 'SEMIANNUAL',  // Cada 6 meses
  ANNUAL     = 'ANNUAL',      // Anual
  ONE_TIME   = 'ONE_TIME',    // Cobro único (extraordinario)
}

registerEnumType(FeeFrequency, {
  name: 'FeeFrequency',
  description: 'Frecuencia de facturación de una configuración de cuota',
});
