import { registerEnumType } from '@nestjs/graphql';

export enum AmenityFeeType {
  /** Sin costo */
  FREE = 'FREE',
  /** Monto fijo por reserva, sin importar la duración */
  PER_BOOKING = 'PER_BOOKING',
  /** feeAmount × horas reservadas (fracción de hora se prorratea) */
  PER_HOUR = 'PER_HOUR',
}

registerEnumType(AmenityFeeType, {
  name: 'AmenityFeeType',
  description: 'Forma de cobro de la reserva de zona común',
});
