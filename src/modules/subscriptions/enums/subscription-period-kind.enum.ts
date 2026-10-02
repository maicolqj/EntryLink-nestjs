import { registerEnumType } from '@nestjs/graphql';

export enum SubscriptionPeriodKind {
  /** Periodo inicial que recibieron los complejos que ya operaban al lanzar las suscripciones. */
  INITIAL = 'INITIAL',
  /** Prueba gratis que el SUPER_ADMIN otorga una vez por complejo, con los días que elija. */
  TRIAL = 'TRIAL',
  /** Días gratis de cortesía (por recomendar, promoción…). Se pueden repetir. */
  COURTESY = 'COURTESY',
  /** Periodo pagado (mensual o anual). */
  PAID = 'PAID',
}

registerEnumType(SubscriptionPeriodKind, {
  name: 'SubscriptionPeriodKind',
  description: 'Origen de un periodo de suscripción',
  valuesMap: {
    INITIAL: { description: 'Periodo inicial al lanzar las suscripciones' },
    TRIAL: { description: 'Prueba gratis' },
    COURTESY: { description: 'Días gratis de cortesía' },
    PAID: { description: 'Periodo pagado' },
  },
});
