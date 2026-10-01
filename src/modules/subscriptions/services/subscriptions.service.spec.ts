import { SubscriptionsService } from './subscriptions.service';
import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { BillingCycle } from '../enums/billing-cycle.enum';
import { SubscriptionPeriodKind } from '../enums/subscription-period-kind.enum';
import { CustomError } from '../../shared/utils/errors.utils';

const COMPLEX_ID = '11111111-1111-1111-1111-111111111111';
const DAY = 86_400_000;

/**
 * Arma el servicio con una transacción falsa: guarda lo que se crea y lo que
 * se actualiza en el complejo, para revisar las fechas.
 */
const build = (opts: {
  endsAt?: Date | null;
  price?: { monthlyPrice: number; annualPrice?: number | null } | null;
  trialUsed?: boolean;
  pricing?: { mode: string; price?: number | null; cycle?: string };
  units?: number;
  taxes?: { name: string; rate: number }[];
  periods?: Record<string, any>[];
}) => {
  const saved: Record<string, any>[] = [];
  const updates: Record<string, any>[] = [];
  const complex = {
    id: COMPLEX_ID,
    name: 'Torres',
    plan: ComplexPlan.FREE,
    totalUnits: null,
    subscriptionEndsAt: opts.endsAt ?? null,
    subscriptionPricingMode: opts.pricing?.mode ?? 'PLAN',
    subscriptionPrice: opts.pricing?.price ?? null,
    subscriptionCycle: opts.pricing?.cycle ?? 'MONTHLY',
  };

  const periodRepoTx = {
    create: (x: any) => x,
    save: jest.fn(async (x: any) => {
      const row = { id: `p${saved.length + 1}`, ...x };
      saved.push(row);
      return row;
    }),
    exists: jest.fn(async () => opts.trialUsed ?? false),
    find: jest.fn(async () => opts.periods ?? []),
    findOne: jest.fn(async () => {
      const all = [...(opts.periods ?? []), ...saved];
      return all.sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
    }),
  };
  const complexRepoTx = {
    createQueryBuilder: () => {
      const qb: any = {
        setLock: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getOne: async () => complex,
      };
      return qb;
    },
    update: jest.fn(async (_id: string, patch: any) => updates.push(patch)),
  };
  const manager = {
    getRepository: (entity: { name: string }) =>
      entity.name === 'SubscriptionPeriod' ? periodRepoTx : complexRepoTx,
  };

  const service = Object.create(
    SubscriptionsService.prototype,
  ) as SubscriptionsService;
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn() },
    dataSource: { transaction: (fn: any) => fn(manager) },
    priceRepo: {
      findOne: jest.fn(async () =>
        opts.price === null || opts.price === undefined
          ? null
          : { plan: ComplexPlan.BASIC, ...opts.price },
      ),
    },
    complexRepo: { findOne: jest.fn(async () => complex) },
    unitRepo: { count: jest.fn(async () => opts.units ?? 0) },
    taxRepo: {
      find: jest.fn(async () =>
        (opts.taxes ?? []).map((t) => ({ ...t, isActive: true })),
      ),
    },
    cacheService: { delete: jest.fn() },
    notificationsService: {
      notify: jest.fn(),
      findSuperAdminUserIds: jest.fn(async () => []),
    },
  });
  jest.spyOn(service, 'getSummary').mockResolvedValue({} as never);
  return { service, saved, updates };
};

describe('SubscriptionsService — renovar', () => {
  it('si aún no vence, el periodo nuevo arranca al terminar el actual', async () => {
    const currentEnd = new Date(Date.now() + 10 * DAY);
    const { service, saved, updates } = build({
      endsAt: currentEnd,
      price: { monthlyPrice: 100_000 },
    });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.BASIC,
        cycle: BillingCycle.MONTHLY,
      },
      'admin',
    );

    expect(saved[0].startsAt.getTime()).toBe(currentEnd.getTime());
    expect(saved[0].kind).toBe(SubscriptionPeriodKind.PAID);
    expect(saved[0].amount).toBe(100_000);
    expect(updates[0]).toEqual(
      expect.objectContaining({
        plan: ComplexPlan.BASIC,
        maxUnits: 50,
        subscriptionEndsAt: saved[0].endsAt,
      }),
    );
  });

  it('si ya venció, arranca hoy: no se cobra el tiempo vencido', async () => {
    const before = Date.now();
    const { service, saved } = build({
      endsAt: new Date(Date.now() - 20 * DAY),
      price: { monthlyPrice: 100_000 },
    });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.BASIC,
        cycle: BillingCycle.MONTHLY,
      },
      'admin',
    );

    expect(saved[0].startsAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('el anual sin precio propio vale 10 mensualidades', async () => {
    const { service, saved } = build({ price: { monthlyPrice: 100_000 } });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.BASIC,
        cycle: BillingCycle.ANNUAL,
      },
      'admin',
    );

    expect(saved[0].amount).toBe(1_000_000);
  });

  it('el valor indicado manda sobre el precio configurado', async () => {
    const { service, saved } = build({ price: { monthlyPrice: 100_000 } });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.BASIC,
        cycle: BillingCycle.MONTHLY,
        amount: 80_000,
      },
      'admin',
    );

    expect(saved[0].amount).toBe(80_000);
  });

  it('sin precio ni valor no registra nada', async () => {
    const { service, saved } = build({ price: null });

    await expect(
      service.renew(
        {
          complexId: COMPLEX_ID,
          plan: ComplexPlan.PRO,
          cycle: BillingCycle.MONTHLY,
        },
        'admin',
      ),
    ).rejects.toBeInstanceOf(CustomError);
    expect(saved).toHaveLength(0);
  });

  it('el plan Gratis no se paga: es solo la prueba', async () => {
    const { service } = build({ price: { monthlyPrice: 0 } });

    await expect(
      service.renew(
        {
          complexId: COMPLEX_ID,
          plan: ComplexPlan.FREE,
          cycle: BillingCycle.MONTHLY,
        },
        'admin',
      ),
    ).rejects.toBeInstanceOf(CustomError);
  });
});

describe('SubscriptionsService — fecha de inicio', () => {
  it('empieza hoy y recorta el periodo inicial que seguía corriendo', async () => {
    const today = new Date();
    const initial = {
      id: 'ini',
      kind: SubscriptionPeriodKind.INITIAL,
      startsAt: new Date(today.getTime() - 5 * DAY),
      endsAt: new Date(today.getTime() + 25 * DAY),
      notes: null,
    };
    const { service, saved, updates } = build({
      endsAt: initial.endsAt,
      price: { monthlyPrice: 100_000 },
      periods: [initial],
    });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.BASIC,
        cycle: BillingCycle.MONTHLY,
        startsAt: today,
      },
      'admin',
    );

    const paid = saved.find((p) => p.kind === SubscriptionPeriodKind.PAID)!;
    expect(paid.startsAt.getTime()).toBe(today.getTime());
    expect(initial.endsAt.getTime()).toBe(today.getTime());
    expect(initial.notes).toContain('Recortado');
    expect(updates[0].subscriptionEndsAt).toEqual(paid.endsAt);
  });

  it('no deja empezar dentro de un periodo ya pagado', async () => {
    const today = new Date();
    const { service, saved } = build({
      price: { monthlyPrice: 100_000 },
      periods: [
        {
          id: 'pag',
          kind: SubscriptionPeriodKind.PAID,
          startsAt: new Date(today.getTime() - 10 * DAY),
          endsAt: new Date(today.getTime() + 20 * DAY),
        },
      ],
    });

    await expect(
      service.renew(
        {
          complexId: COMPLEX_ID,
          plan: ComplexPlan.BASIC,
          cycle: BillingCycle.MONTHLY,
          startsAt: today,
        },
        'admin',
      ),
    ).rejects.toBeInstanceOf(CustomError);
    expect(saved).toHaveLength(0);
  });
});

describe('SubscriptionsService — cobro personalizado', () => {
  const IVA = [{ name: 'IVA', rate: 19 }];

  it('por unidad: cobra valor × unidades + IVA y guarda el desglose', async () => {
    const { service, saved } = build({
      pricing: { mode: 'PER_UNIT', price: 2_000 },
      units: 140,
      taxes: IVA,
    });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.PRO,
        cycle: BillingCycle.MONTHLY,
      },
      'admin',
    );

    expect(saved[0]).toEqual(
      expect.objectContaining({
        amount: 333_200,
        subtotal: 280_000,
        taxAmount: 53_200,
        unitCount: 140,
        unitPrice: 2_000,
        pricingMode: 'PER_UNIT',
      }),
    );
  });

  it('valor fijo anual = 10 mensualidades + IVA', async () => {
    const { service, saved } = build({
      pricing: { mode: 'FIXED', price: 500_000 },
      taxes: IVA,
    });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.PRO,
        cycle: BillingCycle.ANNUAL,
      },
      'admin',
    );

    expect(saved[0].amount).toBe(5_950_000);
    expect(saved[0].unitCount).toBeNull();
  });

  it('un valor registrado distinto se reparte hacia atrás con el IVA', async () => {
    const { service, saved } = build({
      pricing: { mode: 'PER_UNIT', price: 2_000 },
      units: 140,
      taxes: IVA,
    });

    await service.renew(
      {
        complexId: COMPLEX_ID,
        plan: ComplexPlan.PRO,
        cycle: BillingCycle.MONTHLY,
        amount: 119_000,
      },
      'admin',
    );

    expect(saved[0]).toEqual(
      expect.objectContaining({
        amount: 119_000,
        subtotal: 100_000,
        taxAmount: 19_000,
      }),
    );
  });

  it('sin unidades registradas cobra las declaradas al inscribirse', async () => {
    const { service } = build({
      pricing: { mode: 'PER_UNIT', price: 1_000 },
      units: 0,
    });
    (service as any).complexRepo.findOne = jest.fn(async () => ({
      id: COMPLEX_ID,
      plan: ComplexPlan.FREE,
      totalUnits: 800,
      subscriptionPricingMode: 'PER_UNIT',
      subscriptionPrice: 1_000,
      subscriptionCycle: 'MONTHLY',
    }));

    const quote = await service.getQuote(COMPLEX_ID);

    expect(quote).toEqual(
      expect.objectContaining({
        unitCount: 800,
        unitCountSource: 'DECLARED',
        total: 800_000,
      }),
    );
  });
});

describe('SubscriptionsService — prueba gratis', () => {
  it('otorga 30 días sin cambiar el plan del complejo', async () => {
    const before = Date.now();
    const { service, saved, updates } = build({ endsAt: null });

    await service.grantTrial({ complexId: COMPLEX_ID }, 'admin');

    const days =
      (saved[0].endsAt.getTime() - saved[0].startsAt.getTime()) / DAY;
    expect(days).toBe(30);
    expect(saved[0].startsAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved[0].kind).toBe(SubscriptionPeriodKind.TRIAL);
    expect(updates[0]).toEqual({ subscriptionEndsAt: saved[0].endsAt });
  });

  it('una sola vez por complejo', async () => {
    const { service, saved } = build({ trialUsed: true });

    await expect(
      service.grantTrial({ complexId: COMPLEX_ID }, 'admin'),
    ).rejects.toBeInstanceOf(CustomError);
    expect(saved).toHaveLength(0);
  });
});
