import { registerEnumType } from '@nestjs/graphql';

/**
 * Naturaleza del saldo de la cuenta PUC.
 * Activo / Gasto / Costo → DEBITO.
 * Pasivo / Patrimonio / Ingreso → CREDITO.
 */
export enum AccountNature {
  DEBIT  = 'DEBIT',
  CREDIT = 'CREDIT',
}

registerEnumType(AccountNature, {
  name: 'AccountNature',
  description: 'Naturaleza del saldo de la cuenta contable',
});

/** Clase contable (primer dígito del código PUC). */
export enum AccountClass {
  ASSET     = '1', // Activo
  LIABILITY = '2', // Pasivo (anticipos = 2805 ingresos recibidos por anticipado)
  EQUITY    = '3', // Patrimonio
  INCOME    = '4', // Ingresos
  EXPENSE   = '5', // Gastos
  COST      = '6', // Costos
}

registerEnumType(AccountClass, {
  name: 'AccountClass',
  description: 'Clase contable PUC (primer dígito del código)',
});
