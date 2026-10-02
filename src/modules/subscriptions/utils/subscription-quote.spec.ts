import { TaxRate, computeQuote, splitTotal } from './subscription-quote';

const IVA: TaxRate[] = [{ name: 'IVA', rate: 19, kind: 'CHARGE' }];
const RETEFUENTE = (rate: number): TaxRate => ({
  name: 'Retención en la fuente',
  rate,
  kind: 'WITHHOLDING',
});

describe('computeQuote', () => {
  it('por unidad: valor × unidades + IVA', () => {
    const q = computeQuote({
      mode: 'PER_UNIT',
      cycle: 'MONTHLY',
      price: 2_000,
      unitCount: 140,
      taxes: IVA,
    });

    expect(q).toEqual(
      expect.objectContaining({
        configured: true,
        monthlySubtotal: 280_000,
        subtotal: 280_000,
        taxAmount: 53_200,
        total: 333_200,
      }),
    );
  });

  it('un conjunto de 800 unidades paga en proporción', () => {
    const q = computeQuote({
      mode: 'PER_UNIT',
      cycle: 'MONTHLY',
      price: 2_000,
      unitCount: 800,
      taxes: IVA,
    });

    expect(q.subtotal).toBe(1_600_000);
    expect(q.total).toBe(1_904_000);
  });

  it('anual = 10 mensualidades', () => {
    const q = computeQuote({
      mode: 'PER_UNIT',
      cycle: 'ANNUAL',
      price: 2_000,
      unitCount: 140,
      taxes: IVA,
    });

    expect(q.monthsCharged).toBe(10);
    expect(q.subtotal).toBe(2_800_000);
    expect(q.total).toBe(3_332_000);
  });

  it('por plan: precio de lista + impuestos', () => {
    const q = computeQuote({
      mode: 'PLAN',
      cycle: 'MONTHLY',
      planMonthlyPrice: 300_000,
      unitCount: 0,
      taxes: IVA,
    });

    expect(q.total).toBe(357_000);
  });

  it('por plan anual respeta el precio anual fijado a mano', () => {
    const q = computeQuote({
      mode: 'PLAN',
      cycle: 'ANNUAL',
      planMonthlyPrice: 300_000,
      planAnnualPrice: 2_500_000,
      unitCount: 0,
      taxes: [],
    });

    expect(q.subtotal).toBe(2_500_000);
  });

  it('valor fijo con varios impuestos', () => {
    const q = computeQuote({
      mode: 'FIXED',
      cycle: 'MONTHLY',
      price: 500_000,
      unitCount: 900,
      taxes: [
        { name: 'IVA', rate: 19, kind: 'CHARGE' },
        { name: 'Otro', rate: 1, kind: 'CHARGE' },
      ],
    });

    expect(q.taxes.map((t) => t.amount)).toEqual([95_000, 5_000]);
    expect(q.total).toBe(600_000);
  });

  it('sin precio no hay valor que cobrar', () => {
    expect(
      computeQuote({
        mode: 'PER_UNIT',
        cycle: 'MONTHLY',
        unitCount: 140,
        taxes: IVA,
      }).configured,
    ).toBe(false);
    expect(
      computeQuote({ mode: 'PLAN', cycle: 'MONTHLY', unitCount: 0, taxes: IVA })
        .configured,
    ).toBe(false);
  });
});

describe('computeQuote — retenciones', () => {
  it('la retención se calcula sobre el subtotal y se descuenta de lo que paga', () => {
    const q = computeQuote({
      mode: 'FIXED',
      cycle: 'MONTHLY',
      price: 1_000_000,
      unitCount: 0,
      taxes: [...IVA, RETEFUENTE(4)],
    });

    expect(q).toEqual(
      expect.objectContaining({
        subtotal: 1_000_000,
        taxAmount: 190_000,
        withholdingAmount: 40_000,
        invoiceTotal: 1_190_000,
        total: 1_150_000,
      }),
    );
    expect(q.taxes).toEqual([
      { name: 'IVA', rate: 19, kind: 'CHARGE', amount: 190_000 },
      {
        name: 'Retención en la fuente',
        rate: 4,
        kind: 'WITHHOLDING',
        amount: 40_000,
      },
    ]);
  });

  it('cada conjunto paga según su propia retención', () => {
    const totals = [2, 4, 6].map(
      (rate) =>
        computeQuote({
          mode: 'FIXED',
          cycle: 'MONTHLY',
          price: 1_000_000,
          unitCount: 0,
          taxes: [...IVA, RETEFUENTE(rate)],
        }).total,
    );

    expect(totals).toEqual([1_170_000, 1_150_000, 1_130_000]);
  });
});

describe('splitTotal', () => {
  it('saca el subtotal de un valor con IVA incluido', () => {
    expect(splitTotal(119_000, IVA)).toEqual({
      subtotal: 100_000,
      taxes: [{ name: 'IVA', rate: 19, kind: 'CHARGE', amount: 19_000 }],
      taxAmount: 19_000,
      withholdingAmount: 0,
      invoiceTotal: 119_000,
      total: 119_000,
    });
  });

  it('con retención: lo pagado es neto, el subtotal sale hacia atrás', () => {
    const b = splitTotal(1_150_000, [...IVA, RETEFUENTE(4)]);

    expect(b.subtotal).toBe(1_000_000);
    expect(b.taxAmount).toBe(190_000);
    expect(b.withholdingAmount).toBe(40_000);
    expect(b.invoiceTotal).toBe(1_190_000);
    expect(b.total).toBe(1_150_000);
  });

  it('el desglose siempre suma exactamente lo pagado', () => {
    const b = splitTotal(333_333, [...IVA, RETEFUENTE(6)]);

    expect(
      Math.round((b.subtotal + b.taxAmount - b.withholdingAmount) * 100) / 100,
    ).toBe(333_333);
  });
});
