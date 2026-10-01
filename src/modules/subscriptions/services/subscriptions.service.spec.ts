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
}) => {
  const saved: Record<string, any>[] = [];
  const updates: Record<string, any>[] = [];
  const complex = {
    id: COMPLEX_ID,
    name: 'Torres',
    plan: ComplexPlan.FREE,
    subscriptionEndsAt: opts.endsAt ?? null,
  };

  const periodRepoTx = {
    create: (x: any) => x,
    save: jest.fn(async (x: any) => {
      const row = { id: `p${saved.length + 1}`, ...x };
      saved.push(row);
      return row;
    }),
    exists: jest.fn(async () => opts.trialUsed ?? false),
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
