import { registerEnumType } from '@nestjs/graphql';

export enum SubscriptionPeriodKind {
  /** Periodo inicial que recibieron los complejos que ya operaban al lanzar las suscripciones. */
  INITIAL = 'INITIAL',
  /** Prueba gratis de 30 días que el SUPER_ADMIN otorga a complejos seleccionados. */
  TRIAL = 'TRIAL',
  /** Periodo pagado (mensual o anual). */
  PAID = 'PAID',
}

registerEnumType(SubscriptionPeriodKind, {
  name: 'SubscriptionPeriodKind',
  description: 'Origen de un periodo de suscripción',
  valuesMap: {
    INITIAL: { description: 'Periodo inicial al lanzar las suscripciones' },
    TRIAL: { description: 'Prueba gratis' },
    PAID: { description: 'Periodo pagado' },
  },
});
