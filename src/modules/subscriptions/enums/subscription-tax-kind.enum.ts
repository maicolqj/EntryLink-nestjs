import { registerEnumType } from '@nestjs/graphql';

/**
 * Cómo afecta un impuesto al valor de la suscripción.
 *
 * El IVA se suma a lo que se factura; la retención (en la fuente, de IVA, de
 * ICA) la descuenta el conjunto de lo que transfiere y la declara por nosotros.
 * Ambas se calculan sobre el subtotal.
 */
export enum SubscriptionTaxKind {
  CHARGE = 'CHARGE',
  WITHHOLDING = 'WITHHOLDING',
}

registerEnumType(SubscriptionTaxKind, {
  name: 'SubscriptionTaxKind',
  description: 'Si el impuesto se suma al cobro o lo retiene el conjunto',
  valuesMap: {
    CHARGE: { description: 'Se suma al subtotal (IVA)' },
    WITHHOLDING: {
      description: 'Lo retiene el conjunto: se descuenta de lo que paga',
    },
  },
});
