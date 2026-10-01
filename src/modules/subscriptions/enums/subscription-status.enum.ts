import { registerEnumType } from '@nestjs/graphql';

export enum SubscriptionStatus {
  /** El complejo nunca ha tenido un periodo: no se restringe nada. */
  NONE = 'NONE',
  ACTIVE = 'ACTIVE',
  /** Faltan 15 días o menos para vencer. */
  EXPIRING = 'EXPIRING',
  /** Venció hace menos de 5 días: todo sigue funcionando. */
  GRACE = 'GRACE',
  /** Pasó la gracia: el panel administrativo queda en solo lectura. */
  SUSPENDED = 'SUSPENDED',
}

registerEnumType(SubscriptionStatus, {
  name: 'SubscriptionStatus',
  description:
    'Estado de la suscripción del complejo, calculado a partir de su vencimiento',
  valuesMap: {
    NONE: { description: 'Sin suscripción registrada' },
    ACTIVE: { description: 'Vigente' },
    EXPIRING: { description: 'Por vencer (15 días o menos)' },
    GRACE: { description: 'Vencida, en periodo de gracia' },
    SUSPENDED: { description: 'Suspendida por falta de pago' },
  },
});
