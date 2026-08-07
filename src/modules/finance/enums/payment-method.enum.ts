import { registerEnumType } from '@nestjs/graphql';

export enum PaymentMethod {
  CASH             = 'CASH',
  BANK_TRANSFER    = 'BANK_TRANSFER',
  PSE              = 'PSE',           // Débito en línea (Colombia)
  CREDIT_CARD      = 'CREDIT_CARD',
  DEBIT_CARD       = 'DEBIT_CARD',
  NEQUI            = 'NEQUI',
  DAVIPLATA        = 'DAVIPLATA',
  OTHER            = 'OTHER',
}

registerEnumType(PaymentMethod, {
  name: 'PaymentMethod',
  description: 'Método de pago utilizado',
});

/** Etiquetas legibles (ES) por método — para descripciones de auditoría y UI. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]:          'Efectivo',
  [PaymentMethod.BANK_TRANSFER]: 'Transferencia bancaria',
  [PaymentMethod.PSE]:           'PSE',
  [PaymentMethod.CREDIT_CARD]:   'Tarjeta de crédito',
  [PaymentMethod.DEBIT_CARD]:    'Tarjeta débito',
  [PaymentMethod.NEQUI]:         'Nequi',
  [PaymentMethod.DAVIPLATA]:     'Daviplata',
  [PaymentMethod.OTHER]:         'Otro',
};
