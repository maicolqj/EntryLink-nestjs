import { registerEnumType } from '@nestjs/graphql';

/**
 * Cómo se calcula lo que paga cada conjunto. No paga lo mismo una copropiedad
 * de 140 unidades que una de 800: el valor se configura por complejo.
 */
export enum SubscriptionPricingMode {
  /** Valor por unidad × unidades del conjunto. */
  PER_UNIT = 'PER_UNIT',
  /** Precio de lista del plan. */
  PLAN = 'PLAN',
  /** Valor mensual acordado solo para este conjunto. */
  FIXED = 'FIXED',
}

registerEnumType(SubscriptionPricingMode, {
  name: 'SubscriptionPricingMode',
  description: 'Modalidad de cobro de la suscripción del conjunto',
  valuesMap: {
    PER_UNIT: { description: 'Valor por unidad × unidades' },
    PLAN: { description: 'Precio de lista del plan' },
    FIXED: { description: 'Valor fijo acordado con el conjunto' },
  },
});
