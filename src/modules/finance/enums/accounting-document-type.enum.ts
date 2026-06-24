import { registerEnumType } from '@nestjs/graphql';

/**
 * Tipos de documento del libro diario (comprobantes).
 * Cada tipo lleva su propio consecutivo legal por copropiedad.
 */
export enum AccountingDocumentType {
  INVOICE         = 'INVOICE',          // Factura / causación de cuota (CxC)
  CASH_RECEIPT    = 'CASH_RECEIPT',     // Recibo de caja (ingreso)
  EXPENSE_VOUCHER = 'EXPENSE_VOUCHER',  // Comprobante de egreso (gasto / pago proveedor)
  ACCOUNTING_NOTE = 'ACCOUNTING_NOTE',  // Nota contable / ajuste / contra-asiento
  CREDIT_NOTE     = 'CREDIT_NOTE',      // Nota crédito
}

registerEnumType(AccountingDocumentType, {
  name: 'AccountingDocumentType',
  description: 'Tipo de comprobante contable del libro diario',
});
