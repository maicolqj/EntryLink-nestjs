import { computeQuote, splitTotal } from './subscription-quote';

const IVA = [{ name: 'IVA', rate: 19 }];

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
        { name: 'IVA', rate: 19 },
        { name: 'Otro', rate: 1 },
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

describe('splitTotal', () => {
  it('saca el subtotal de un valor con IVA incluido', () => {
    expect(splitTotal(119_000, IVA)).toEqual({
      subtotal: 100_000,
      taxes: [{ name: 'IVA', rate: 19, amount: 19_000 }],
      taxAmount: 19_000,
    });
  });
});
