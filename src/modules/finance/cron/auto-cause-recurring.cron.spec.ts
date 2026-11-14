import { AutoCauseRecurringCron } from './auto-cause-recurring.cron';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

const pause = {
  id: 'p1',
  complexId: 'c1',
  pausedAt: new Date('2026-09-20T13:00:00.000Z'),
  resumedAt: new Date('2026-11-02T13:00:00.000Z'),
};

const build = (causeImpl: () => Promise<unknown>) => {
  const qb = {
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    getMany: async () => [pause],
  };
  const pauseRepo = {
    createQueryBuilder: () => qb,
    update: jest.fn(async () => undefined),
  };
  const recurringRepo = {
    find: async () => [{ billingDay: 15 }, { billingDay: 1 }],
  };
  const accountingService = {
    causeRecurringChargesInternal: jest.fn(causeImpl),
  };
  const cron = new AutoCauseRecurringCron(
    recurringRepo as never,
    accountingService as never,
    pauseRepo as never,
  );
  return { cron, pauseRepo, accountingService };
};

const ok = async () => ({ caused: 1, skipped: 0, totalAmount: 10 });

describe('AutoCauseRecurringCron — recurrentes de la pausa', () => {
  it('causa cada fecha de la pausa, de la más vieja a la más nueva', async () => {
    const { cron, accountingService } = build(ok);

    await cron.catchUpPausedPeriods();

    expect(accountingService.causeRecurringChargesInternal.mock.calls).toEqual([
      ['c1', '2026-10', SYSTEM_USER_ID, 1],
      ['c1', '2026-10', SYSTEM_USER_ID, 15],
      ['c1', '2026-11', SYSTEM_USER_ID, 1],
    ]);
  });

  it('marca la pausa como recuperada al terminar', async () => {
    const { cron, pauseRepo } = build(ok);

    await cron.catchUpPausedPeriods();

    expect(pauseRepo.update).toHaveBeenCalledWith('p1', {
      recurringCaughtUpAt: expect.any(Date),
    });
  });

  it('si falla no marca, para reintentar mañana', async () => {
    const { cron, pauseRepo } = build(async () => {
      throw new Error('sin PUC');
    });

    await cron.catchUpPausedPeriods();

    expect(pauseRepo.update).not.toHaveBeenCalled();
  });
});
