import { registerEnumType } from '@nestjs/graphql';

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

registerEnumType(BillingCycle, {
  name: 'BillingCycle',
  description: 'Ciclo de cobro de la suscripción',
  valuesMap: {
    MONTHLY: { description: 'Mensual' },
    ANNUAL: { description: 'Anual' },
  },
});
