import { AccountNature, AccountClass } from '../../../../modules/finance/enums/account-nature.enum';

export interface PucSeedRow {
  code: string;
  name: string;
  accountClass: AccountClass;
  nature: AccountNature;
  /** Solo las hoja (postable) admiten movimientos contables. */
  isPostable: boolean;
  level: number;
  /** Código del padre en el árbol, o null para las clases raíz. */
  parentCode: string | null;
}

/**
 * Plan Único de Cuentas base para propiedad horizontal (Colombia, Ley 675).
 * Mínimo funcional para los flujos de ingresos y egresos del módulo.
 * Las cuentas de agrupación (clase/grupo) NO son posteables; solo las hoja.
 *
 * Cuentas clave usadas por los procesos automáticos:
 *   1105/1110 Caja/Bancos · 1311 CxC cuotas · 2335 Proveedores ·
 *   2805 Anticipos (pasivo) · 4225 Cuotas admón · 4210 Intereses de mora.
 */
export const PUC_PH_SEED: PucSeedRow[] = [
  // ─── 1. ACTIVO ────────────────────────────────────────────────
  { code: '1',    name: 'ACTIVO',                              accountClass: AccountClass.ASSET, nature: AccountNature.DEBIT,  isPostable: false, level: 1, parentCode: null },
  { code: '11',   name: 'Disponible',                          accountClass: AccountClass.ASSET, nature: AccountNature.DEBIT,  isPostable: false, level: 2, parentCode: '1' },
  { code: '1105', name: 'Caja',                                accountClass: AccountClass.ASSET, nature: AccountNature.DEBIT,  isPostable: true,  level: 3, parentCode: '11' },
  { code: '1110', name: 'Bancos',                              accountClass: AccountClass.ASSET, nature: AccountNature.DEBIT,  isPostable: true,  level: 3, parentCode: '11' },
  { code: '13',   name: 'Deudores',                            accountClass: AccountClass.ASSET, nature: AccountNature.DEBIT,  isPostable: false, level: 2, parentCode: '1' },
  { code: '1311', name: 'Cuotas de administración por cobrar', accountClass: AccountClass.ASSET, nature: AccountNature.DEBIT,  isPostable: true,  level: 3, parentCode: '13' },
  { code: '1345', name: 'Multas e intereses por cobrar',       accountClass: AccountClass.ASSET, nature: AccountNature.DEBIT,  isPostable: true,  level: 3, parentCode: '13' },

  // ─── 2. PASIVO ────────────────────────────────────────────────
  { code: '2',    name: 'PASIVO',                              accountClass: AccountClass.LIABILITY, nature: AccountNature.CREDIT, isPostable: false, level: 1, parentCode: null },
  { code: '23',   name: 'Cuentas por pagar',                   accountClass: AccountClass.LIABILITY, nature: AccountNature.CREDIT, isPostable: false, level: 2, parentCode: '2' },
  { code: '2335', name: 'Costos y gastos por pagar (proveedores)', accountClass: AccountClass.LIABILITY, nature: AccountNature.CREDIT, isPostable: true, level: 3, parentCode: '23' },
  { code: '28',   name: 'Otros pasivos',                       accountClass: AccountClass.LIABILITY, nature: AccountNature.CREDIT, isPostable: false, level: 2, parentCode: '2' },
  { code: '2805', name: 'Ingresos recibidos por anticipado (anticipos)', accountClass: AccountClass.LIABILITY, nature: AccountNature.CREDIT, isPostable: true, level: 3, parentCode: '28' },

  // ─── 3. PATRIMONIO ────────────────────────────────────────────
  { code: '3',    name: 'PATRIMONIO',                          accountClass: AccountClass.EQUITY, nature: AccountNature.CREDIT, isPostable: false, level: 1, parentCode: null },
  { code: '32',   name: 'Fondos',                              accountClass: AccountClass.EQUITY, nature: AccountNature.CREDIT, isPostable: false, level: 2, parentCode: '3' },
  { code: '3205', name: 'Fondo de imprevistos (Ley 675 art. 35)', accountClass: AccountClass.EQUITY, nature: AccountNature.CREDIT, isPostable: true, level: 3, parentCode: '32' },

  // ─── 4. INGRESOS ──────────────────────────────────────────────
  { code: '4',    name: 'INGRESOS',                            accountClass: AccountClass.INCOME, nature: AccountNature.CREDIT, isPostable: false, level: 1, parentCode: null },
  { code: '42',   name: 'Ingresos operacionales',             accountClass: AccountClass.INCOME, nature: AccountNature.CREDIT, isPostable: false, level: 2, parentCode: '4' },
  { code: '4225', name: 'Cuotas de administración',           accountClass: AccountClass.INCOME, nature: AccountNature.CREDIT, isPostable: true,  level: 3, parentCode: '42' },
  { code: '4210', name: 'Intereses de mora',                  accountClass: AccountClass.INCOME, nature: AccountNature.CREDIT, isPostable: true,  level: 3, parentCode: '42' },
  { code: '4220', name: 'Parqueaderos de visitantes',         accountClass: AccountClass.INCOME, nature: AccountNature.CREDIT, isPostable: true,  level: 3, parentCode: '42' },
  { code: '4295', name: 'Otros ingresos (multas, zonas comunes)', accountClass: AccountClass.INCOME, nature: AccountNature.CREDIT, isPostable: true, level: 3, parentCode: '42' },

  // ─── 5. GASTOS ────────────────────────────────────────────────
  { code: '5',    name: 'GASTOS',                              accountClass: AccountClass.EXPENSE, nature: AccountNature.DEBIT, isPostable: false, level: 1, parentCode: null },
  { code: '51',   name: 'Gastos de administración',           accountClass: AccountClass.EXPENSE, nature: AccountNature.DEBIT, isPostable: false, level: 2, parentCode: '5' },
  { code: '5105', name: 'Gastos de personal',                 accountClass: AccountClass.EXPENSE, nature: AccountNature.DEBIT, isPostable: true,  level: 3, parentCode: '51' },
  { code: '5135', name: 'Servicios públicos',                 accountClass: AccountClass.EXPENSE, nature: AccountNature.DEBIT, isPostable: true,  level: 3, parentCode: '51' },
  { code: '5145', name: 'Mantenimiento y reparaciones',       accountClass: AccountClass.EXPENSE, nature: AccountNature.DEBIT, isPostable: true,  level: 3, parentCode: '51' },
  { code: '5195', name: 'Diversos',                           accountClass: AccountClass.EXPENSE, nature: AccountNature.DEBIT, isPostable: true,  level: 3, parentCode: '51' },
];
