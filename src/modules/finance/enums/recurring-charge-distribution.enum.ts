import { registerEnumType } from '@nestjs/graphql';

/** Cómo se reparte el monto de un cobro recurrente entre las unidades elegidas. */
export enum RecurringChargeDistribution {
  /** Por coeficiente de copropiedad, renormalizado al subgrupo elegido (suma del subgrupo = monto). */
  COEFFICIENT = 'COEFFICIENT',
  /** Partes iguales: monto ÷ Nº de unidades elegidas. */
  EQUAL = 'EQUAL',
  /** Fijo: el monto es lo que paga CADA unidad elegida (no se divide). */
  FIXED_PER_UNIT = 'FIXED_PER_UNIT',
}

registerEnumType(RecurringChargeDistribution, {
  name: 'RecurringChargeDistribution',
  description: 'Método de reparto del monto de un cobro recurrente',
});
