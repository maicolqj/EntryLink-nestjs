import { registerEnumType } from '@nestjs/graphql';

/** Estado del soporte de pago que envía el conjunto para renovar. */
export enum SubscriptionPaymentStatus {
  /** Enviado; espera que el SUPER_ADMIN compare el soporte con la cuenta. */
  PENDING = 'PENDING',
  /** Aprobado: se registró el pago y se extendió la suscripción. */
  APPROVED = 'APPROVED',
  /** Rechazado con motivo; el conjunto puede enviar otro. */
  REJECTED = 'REJECTED',
}

registerEnumType(SubscriptionPaymentStatus, {
  name: 'SubscriptionPaymentStatus',
  description: 'Estado del soporte de pago enviado por el conjunto',
  valuesMap: {
    PENDING: { description: 'Pendiente de revisión' },
    APPROVED: { description: 'Aprobado: suscripción renovada' },
    REJECTED: { description: 'Rechazado con motivo' },
  },
});
