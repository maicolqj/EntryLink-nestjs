import { ANNUAL_MONTHS_CHARGED } from './subscription-status';

/**
 * Cálculo del valor a cobrar. Sin dependencias de Nest ni de la base: recibe
 * todo resuelto y devuelve el desglose, para que el aviso, el banner, el
 * formulario de pago y lo que queda guardado en el periodo digan lo mismo.
 */
export type PricingMode = 'PER_UNIT' | 'PLAN' | 'FIXED';
export type Cycle = 'MONTHLY' | 'ANNUAL';

export interface TaxRate {
  name: string;
  /** Porcentaje: 19 = 19 %. */
  rate: number;
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

export interface Quote {
  /** false cuando falta el precio: no hay valor que cobrar todavía. */
  configured: boolean;
  monthlySubtotal: number;
  monthsCharged: number;
  subtotal: number;
  taxes: QuoteTaxLine[];
  taxAmount: number;
  total: number;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const monthsCharged = (cycle: Cycle) =>
  cycle === 'ANNUAL' ? ANNUAL_MONTHS_CHARGED : 1;

function withTaxes(
  subtotal: number,
  months: number,
  monthly: number,
  taxes: TaxRate[],
): Quote {
  const lines = taxes.map((t) => ({
    name: t.name,
    rate: t.rate,
    amount: round2((subtotal * t.rate) / 100),
  }));
  const taxAmount = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  return {
    configured: true,
    monthlySubtotal: round2(monthly),
    monthsCharged: months,
    subtotal: round2(subtotal),
    taxes: lines,
    taxAmount,
    total: round2(subtotal + taxAmount),
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
    return withTaxes(subtotal, months, input.planMonthlyPrice, input.taxes);
  }

  if (input.price === null || input.price === undefined) return empty;

  const monthly =
    input.mode === 'PER_UNIT' ? input.price * input.unitCount : input.price;
  return withTaxes(monthly * months, months, monthly, input.taxes);
}

/**
 * Desglose de un valor pagado que ya incluye impuestos (cuando el SUPER_ADMIN
 * registra un valor distinto al calculado): saca el subtotal hacia atrás con
 * las tarifas vigentes.
 */
export function splitTotal(
  total: number,
  taxes: TaxRate[],
): {
  subtotal: number;
  taxes: QuoteTaxLine[];
  taxAmount: number;
} {
  const rate = taxes.reduce((sum, t) => sum + t.rate, 0);
  const subtotal = round2(total / (1 + rate / 100));
  const lines = taxes.map((t) => ({
    name: t.name,
    rate: t.rate,
    amount: round2((subtotal * t.rate) / 100),
  }));
  return { subtotal, taxes: lines, taxAmount: round2(total - subtotal) };
}
