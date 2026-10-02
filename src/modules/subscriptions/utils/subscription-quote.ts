import { ANNUAL_MONTHS_CHARGED } from './subscription-status';

/**
 * Cálculo del valor a cobrar. Sin dependencias de Nest ni de la base: recibe
 * todo resuelto y devuelve el desglose, para que el aviso, el banner, el
 * formulario de pago y lo que queda guardado en el periodo digan lo mismo.
 *
 * Todos los impuestos se calculan sobre el subtotal. Los CHARGE (IVA) se suman
 * a lo facturado; los WITHHOLDING (retención en la fuente…) los descuenta el
 * conjunto de lo que transfiere. `total` es lo que el conjunto paga.
 */
export type PricingMode = 'PER_UNIT' | 'PLAN' | 'FIXED';
export type Cycle = 'MONTHLY' | 'ANNUAL';
export type TaxKind = 'CHARGE' | 'WITHHOLDING';

export interface TaxRate {
  name: string;
  /** Porcentaje: 19 = 19 %. */
  rate: number;
  kind: TaxKind;
}

export interface QuoteInput {
  mode: PricingMode;
  cycle: Cycle;
  /** Valor por unidad (PER_UNIT) o valor mensual fijo (FIXED). */
  price?: number | null;
  /** Precio mensual de lista del plan (PLAN). */
  planMonthlyPrice?: number | null;
  /** Precio anual de lista fijado a mano (PLAN). Vacío = 10 mensualidades. */
  planAnnualPrice?: number | null;
  unitCount: number;
  taxes: TaxRate[];
}

export interface QuoteTaxLine extends TaxRate {
  amount: number;
}

export interface TaxBreakdown {
  subtotal: number;
  taxes: QuoteTaxLine[];
  /** Impuestos que se suman (IVA). */
  taxAmount: number;
  /** Lo que retiene el conjunto. */
  withholdingAmount: number;
  /** Lo facturado: subtotal + impuestos. */
  invoiceTotal: number;
  /** Lo que paga el conjunto: facturado − retenciones. */
  total: number;
}

export interface Quote extends TaxBreakdown {
  /** false cuando falta el precio: no hay valor que cobrar todavía. */
  configured: boolean;
  monthlySubtotal: number;
  monthsCharged: number;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const monthsCharged = (cycle: Cycle) =>
  cycle === 'ANNUAL' ? ANNUAL_MONTHS_CHARGED : 1;

const sumOf = (lines: QuoteTaxLine[], kind: TaxKind) =>
  round2(
    lines.filter((l) => l.kind === kind).reduce((sum, l) => sum + l.amount, 0),
  );

const linesFor = (subtotal: number, taxes: TaxRate[]): QuoteTaxLine[] =>
  taxes.map((t) => ({
    name: t.name,
    rate: t.rate,
    kind: t.kind,
    amount: round2((subtotal * t.rate) / 100),
  }));

/** Desglose a partir del subtotal. */
export function breakdownFromSubtotal(
  subtotal: number,
  taxes: TaxRate[],
): TaxBreakdown {
  const base = round2(subtotal);
  const lines = linesFor(base, taxes);
  const taxAmount = sumOf(lines, 'CHARGE');
  const withholdingAmount = sumOf(lines, 'WITHHOLDING');
  const invoiceTotal = round2(base + taxAmount);
  return {
    subtotal: base,
    taxes: lines,
    taxAmount,
    withholdingAmount,
    invoiceTotal,
    total: round2(invoiceTotal - withholdingAmount),
  };
}

export function computeQuote(input: QuoteInput): Quote {
  const months = monthsCharged(input.cycle);
  const empty: Quote = {
    configured: false,
    monthlySubtotal: 0,
    monthsCharged: months,
    subtotal: 0,
    taxes: [],
    taxAmount: 0,
    withholdingAmount: 0,
    invoiceTotal: 0,
    total: 0,
  };

  if (input.mode === 'PLAN') {
    if (
      input.planMonthlyPrice === null ||
      input.planMonthlyPrice === undefined
    ) {
      return empty;
    }
    const subtotal =
      input.cycle === 'ANNUAL' &&
      input.planAnnualPrice !== null &&
      input.planAnnualPrice !== undefined
        ? input.planAnnualPrice
        : input.planMonthlyPrice * months;
    return {
      configured: true,
      monthlySubtotal: round2(input.planMonthlyPrice),
      monthsCharged: months,
      ...breakdownFromSubtotal(subtotal, input.taxes),
    };
  }

  if (input.price === null || input.price === undefined) return empty;

  const monthly =
    input.mode === 'PER_UNIT' ? input.price * input.unitCount : input.price;
  return {
    configured: true,
    monthlySubtotal: round2(monthly),
    monthsCharged: months,
    ...breakdownFromSubtotal(monthly * months, input.taxes),
  };
}

/**
 * Desglose de un valor pagado (cuando el SUPER_ADMIN registra o corrige un
 * valor distinto al calculado): saca el subtotal hacia atrás con las tarifas
 * dadas. `total` es lo que pagó el conjunto, ya descontadas sus retenciones.
 */
export function splitTotal(total: number, taxes: TaxRate[]): TaxBreakdown {
  const net = taxes.reduce(
    (sum, t) => sum + (t.kind === 'WITHHOLDING' ? -t.rate : t.rate),
    0,
  );
  const factor = 1 + net / 100;
  const subtotal = factor > 0 ? round2(total / factor) : 0;
  const lines = linesFor(subtotal, taxes);
  const withholdingAmount = sumOf(lines, 'WITHHOLDING');
  // El redondeo de cada línea se absorbe en los impuestos, para que el
  // desglose sume exactamente lo pagado.
  const invoiceTotal = round2(total + withholdingAmount);
  return {
    subtotal,
    taxes: lines,
    taxAmount: round2(invoiceTotal - subtotal),
    withholdingAmount,
    invoiceTotal,
    total: round2(total),
  };
}
