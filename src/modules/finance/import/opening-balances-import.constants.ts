/**
 * Importación de SALDOS DE APERTURA (migración desde software contable externo).
 *
 * El complejo exporta su cartera desde su software actual (World Office, Siigo,
 * Helisa, Alegra, etc.) y la vuelca en nuestra plantilla canónica de columnas
 * fijas. Solo se migran SALDOS A UNA FECHA DE CORTE, no el historial completo:
 *
 *   - Saldo de cartera (deuda)  → 1 FeeCharge "Saldo migrado (apertura)" PENDING
 *   - Saldo a favor (anticipo)  → 1 WalletEntry CREDIT
 *
 * El historial detallado se queda en el software anterior. Esto mantiene el
 * ledger contable de partida doble consistente y la operación 100% idempotente.
 */

/** Descripción fija del cargo de cartera migrada. Sirve de marcador de idempotencia. */
export const OPENING_BALANCE_CHARGE_DESC = 'Saldo migrado (apertura)';

/** Descripción fija del crédito de saldo a favor migrado. Marcador de idempotencia. */
export const OPENING_BALANCE_WALLET_DESC = 'Saldo a favor migrado (apertura)';

/** Índices de columna (base 1) de la plantilla canónica. */
export const OPENING_BALANCE_COL = {
  // Agrupador opcional (torre/edificio/bloque). Para conjuntos de CASAS u OFICINAS
  // que no se agrupan, se deja vacío y la unidad se resuelve solo por su número.
  // Solo es necesario si el conjunto tiene torres y el número de unidad se repite entre ellas.
  BUILDING: 1,
  UNIT:     2, // Número/identificador de la unidad (casa/oficina/apto) — requerido
  CARTERA:  3, // Saldo de cartera / deuda a la fecha de corte (>= 0)
  FAVOR:    4, // Saldo a favor / anticipo a la fecha de corte (>= 0)
} as const;

export interface OpeningBalanceRowData {
  rowIndex: number;
  buildingName?: string;
  unitNumber: string;
  carteraRaw: unknown;
  favorRaw: unknown;
}

export interface OpeningBalanceRowError {
  row: number;
  identifier: string;
  message: string;
}

/** Operación planificada para una fila válida (resultado del análisis previo a escribir). */
export interface PlannedOpeningBalance {
  rowIndex: number;
  unitId: string;
  unitNumber: string;
  buildingName?: string;
  cartera: number;       // > 0 si hay deuda a migrar
  favor: number;         // > 0 si hay saldo a favor a migrar
  skipCharge: boolean;   // ya existe un cargo de apertura para (unidad, período)
  skipWallet: boolean;   // ya existe un crédito de apertura para la unidad
}

/**
 * Resultado del import. La MISMA forma se devuelve en modo preview (dryRun=true)
 * y en modo confirmación (dryRun=false); en preview los contadores reflejan lo
 * que SE HARÍA, sin escribir nada en la base de datos.
 */
export interface OpeningBalancesImportResult {
  dryRun: boolean;
  period: string;
  /** Filas de datos leídas del archivo (excluye encabezado y filas vacías). */
  totalRows: number;
  /** Filas válidas (unidad resuelta + al menos un saldo > 0). */
  validRows: number;
  /** Filas con error (no se procesan; ver `errors`). */
  errorRows: number;
  /** Σ de saldos de cartera de las filas válidas. */
  totalCartera: number;
  /** Σ de saldos a favor de las filas válidas. */
  totalFavor: number;
  /** Cargos de cartera creados (o que se crearían en preview). */
  chargesCreated: number;
  /** Créditos de saldo a favor creados (o que se crearían en preview). */
  walletCreditsCreated: number;
  /** Cargos/créditos omitidos por ya existir (idempotencia). */
  skipped: number;
  errors: OpeningBalanceRowError[];
}
