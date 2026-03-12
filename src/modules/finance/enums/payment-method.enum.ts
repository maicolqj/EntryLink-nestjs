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
