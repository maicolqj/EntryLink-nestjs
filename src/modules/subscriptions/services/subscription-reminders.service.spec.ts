import { SubscriptionRemindersService } from './subscription-reminders.service';
import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';

const NOW = new Date('2026-10-01T13:00:00.000Z');
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY);

const build = (opts: {
  endsAt: Date;
  claimed?: boolean;
  email?: string | null;
}) => {
  const complex = {
    id: 'c1',
    name: 'Torres',
    email: opts.email === undefined ? 'admin@torres.co' : opts.email,
    plan: ComplexPlan.BASIC,
    subscriptionEndsAt: opts.endsAt,
  };
  const qb: any = {
    select: () => qb,
    where: () => qb,
    andWhere: () => qb,
    getMany: async () => [complex],
  };
  const insertQb: any = {
    insert: () => insertQb,
    into: () => insertQb,
    values: jest.fn(() => insertQb),
    orIgnore: () => insertQb,
    returning: () => insertQb,
    execute: async () => ({
      raw: opts.claimed === false ? [] : [{ id: 'r1' }],
    }),
  };
  const notifyComplex = jest.fn();
  const queueMail = jest.fn(async () => undefined);

  const service = new SubscriptionRemindersService(
    { createQueryBuilder: () => qb } as never,
    { createQueryBuilder: () => insertQb } as never,
    {
      notifyComplex,
      planLabel: () => 'Básico',
      quoteFor: jest.fn(async () => ({
        configured: true,
        total: 333_200,
        cycle: 'MONTHLY',
      })),
    } as never,
    { queueSubscriptionNoticeEmail: queueMail } as never,
    { get: () => 'https://entrylink.alternaqj.com' } as never,
  );
  return { service, notifyComplex, queueMail, insertQb };
};

describe('SubscriptionRemindersService', () => {
  it('avisa con notificación y correo cuando faltan 7 días', async () => {
    const { service, notifyComplex, queueMail, insertQb } = build({
      endsAt: inDays(7),
    });

    await expect(service.sendDueReminders(NOW)).resolves.toBe(1);

    expect(insertQb.values).toHaveBeenCalledWith(
      expect.objectContaining({ milestone: 'D7' }),
    );
    expect(notifyComplex).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.SUBSCRIPTION_EXPIRING,
        title: 'Tu suscripción vence en 7 días',
        body: expect.stringContaining(
          'Debes renovarla por $\u00a0333.200 (mensual, impuestos incluidos)',
        ),
      }),
    );
    expect(queueMail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@torres.co',
        ctaUrl: 'https://entrylink.alternaqj.com/dashboard/suscripcion',
      }),
    );
  });

  it('no repite un aviso ya enviado', async () => {
    const { service, notifyComplex, queueMail } = build({
      endsAt: inDays(7),
      claimed: false,
    });

    await expect(service.sendDueReminders(NOW)).resolves.toBe(0);
    expect(notifyComplex).not.toHaveBeenCalled();
    expect(queueMail).not.toHaveBeenCalled();
  });

  it('la suspensión también avisa a los SUPER_ADMIN', async () => {
    const { service, notifyComplex } = build({ endsAt: inDays(-6) });

    await service.sendDueReminders(NOW);

    expect(notifyComplex).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.SUBSCRIPTION_SUSPENDED,
        alsoSuperAdmins: expect.objectContaining({
          title: 'Suscripción suspendida',
        }),
      }),
    );
  });

  it('sin correo del complejo, solo la notificación', async () => {
    const { service, notifyComplex, queueMail } = build({
      endsAt: inDays(-1),
      email: null,
    });

    await service.sendDueReminders(NOW);

    expect(notifyComplex).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.SUBSCRIPTION_EXPIRED }),
    );
    expect(queueMail).not.toHaveBeenCalled();
  });
});
