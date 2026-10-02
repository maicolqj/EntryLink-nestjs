import { registerEnumType } from '@nestjs/graphql';

/**
 * Por qué se regalan días de suscripción.
 *
 * TRIAL es la prueba para conocer la app: una sola vez por complejo. Las
 * demás son cortesías (por recomendar a otro conjunto, por una promoción…) y
 * se pueden dar las veces que haga falta.
 */
export enum FreePeriodReason {
  TRIAL = 'TRIAL',
  REFERRAL = 'REFERRAL',
  PROMOTION = 'PROMOTION',
  OTHER = 'OTHER',
}

registerEnumType(FreePeriodReason, {
  name: 'FreePeriodReason',
  description: 'Motivo de los días gratis',
  valuesMap: {
    TRIAL: { description: 'Prueba gratis (una vez por complejo)' },
    REFERRAL: { description: 'Por recomendar a otro conjunto' },
    PROMOTION: { description: 'Promoción' },
    OTHER: { description: 'Otro motivo (explicarlo en las notas)' },
  },
});
