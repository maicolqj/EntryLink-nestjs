import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { SubscriptionCutService } from './subscription-cut.service';

const NOW = new Date('2026-11-09T13:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

type Row = { milestone: string; sentAt: Date };

const build = (opts: {
  mode?: string;
  overdueDays: number;
  rows?: Row[];
  claimed?: boolean;
  notifyFails?: boolean;
  accessCutAt?: Date | null;
}) => {
  const complex = {
    id: 'c1',
    name: 'Torres',
    subscriptionEndsAt: daysAgo(opts.overdueDays),
    subscriptionAccessCutAt: opts.accessCutAt ?? null,
    subscriptionPanicCutAt: null,
  };
  const qb = {
    where: () => qb,
    andWhere: () => qb,
    getMany: async () => [complex],
  };
  const complexRepo = {
    createQueryBuilder: () => qb,
    findOne: jest.fn(async () => complex),
    update: jest.fn(async () => undefined),
  };
  const reminderRepo = {
    find: jest.fn(async () => opts.rows ?? []),
    delete: jest.fn(async () => undefined),
  };
  const remindersService = {
    claim: jest.fn(async (..._args: unknown[]) => opts.claimed ?? true),
  };
  const notificationsService = {
    findUserIdsByRoles: jest.fn(async (..._args: unknown[]) => ['u1', 'u2']),
    notify: jest.fn(async (..._args: any[]) => {
      if (opts.notifyFails) throw new Error('FCM caído');
      return [];
    }),
  };
  const subscriptionsService = {
    notifyComplex: jest.fn(async () => undefined),
  };
  const cacheService = { delete: jest.fn(async () => undefined) };
  const socketService = { emitToComplex: jest.fn() };
  const configService = { get: () => opts.mode };

  const service = new SubscriptionCutService(
    complexRepo as never,
    reminderRepo as never,
    remindersService as never,
    subscriptionsService as never,
    notificationsService as never,
    cacheService as never,
    socketService as never,
    configService as never,
  );
  return {
    service,
    complexRepo,
    reminderRepo,
    remindersService,
    notificationsService,
    subscriptionsService,
    cacheService,
  };
};

const sentAll = (prefix: string): Row[] => [
  { milestone: `${prefix}_N1`, sentAt: daysAgo(20) },
  { milestone: `${prefix}_N2`, sentAt: daysAgo(10) },
  { milestone: `${prefix}_N3`, sentAt: daysAgo(3) },
];

describe('SubscriptionCutService', () => {
  it('con el modo apagado no hace nada', async () => {
    const { service, complexRepo } = build({ mode: 'off', overdueDays: 40 });
    const spy = jest.spyOn(complexRepo, 'createQueryBuilder');

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(spy).not.toHaveBeenCalled();
  });

  it('sin variable definida tampoco hace nada', async () => {
    const { service } = build({ overdueDays: 40 });

    await expect(service.run(NOW)).resolves.toBe(0);
  });

  it('envía el aviso a residentes y portería, y dice que el pánico sigue', async () => {
    const { service, notificationsService, remindersService } = build({
      mode: 'access',
      overdueDays: 10,
    });

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(remindersService.claim).toHaveBeenCalledWith(
      'c1',
      expect.any(Date),
      'ACCESS_N1',
    );
    expect(notificationsService.findUserIdsByRoles).toHaveBeenCalledWith('c1', [
      ValidRoles.RESIDENT_ROL,
      ValidRoles.SECURITY_ROL,
    ]);
    const params = notificationsService.notify.mock.calls[0][0];
    expect(params.type).toBe(NotificationType.COMPLEX_ALERT);
    expect(params.isBroadcast).toBe(true);
    expect(params.body).toContain(
      'La administración de Torres no ha renovado la suscripción de EntryLink.',
    );
    expect(params.body).toContain('El botón de pánico seguirá activo.');
    expect(params.metadata.kind).toBe('SUBSCRIPTION_CUT_NOTICE');
  });

  it('en modo con pánico el aviso dice que deja de funcionar y da el 123', async () => {
    const { service, notificationsService, remindersService } = build({
      mode: 'access_and_panic',
      overdueDays: 10,
    });

    await service.run(NOW);

    expect(remindersService.claim.mock.calls[0][2]).toBe('PANIC_N1');
    const { body } = notificationsService.notify.mock.calls[0][0];
    expect(body).toContain('la app y el botón de pánico dejarán de funcionar');
    expect(body).toContain('En una emergencia marca 123.');
  });

  it('si otro proceso ya reclamó el aviso no lo repite', async () => {
    const { service, notificationsService } = build({
      mode: 'access',
      overdueDays: 10,
      claimed: false,
    });

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('si el aviso falla suelta la fila: no cuenta como enviado', async () => {
    const { service, reminderRepo } = build({
      mode: 'access',
      overdueDays: 10,
      notifyFails: true,
    });

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(reminderRepo.delete).toHaveBeenCalledWith({
      complexId: 'c1',
      endsAt: expect.any(Date),
      milestone: 'ACCESS_N1',
    });
  });

  it('con los 3 avisos corta el acceso, pero no el pánico en modo access', async () => {
    const { service, complexRepo, cacheService, subscriptionsService } = build({
      mode: 'access',
      overdueDays: 30,
      rows: sentAll('ACCESS'),
    });

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(complexRepo.update).toHaveBeenCalledWith('c1', {
      subscriptionAccessCutAt: NOW,
    });
    expect(cacheService.delete).toHaveBeenCalled();
    expect(subscriptionsService.notifyComplex).toHaveBeenCalled();
  });

  it('avisos de modo access no sirven para apagar el pánico', async () => {
    const { service, complexRepo, remindersService } = build({
      mode: 'access_and_panic',
      overdueDays: 60,
      rows: sentAll('ACCESS'),
      accessCutAt: daysAgo(30),
    });

    await service.run(NOW);

    expect(remindersService.claim.mock.calls[0][2]).toBe('PANIC_N1');
    expect(complexRepo.update).not.toHaveBeenCalled();
  });

  it('con 3 avisos de pánico corta también el pánico y respeta la fecha previa', async () => {
    const accessCutAt = daysAgo(30);
    const { service, complexRepo } = build({
      mode: 'access_and_panic',
      overdueDays: 60,
      rows: sentAll('PANIC'),
      accessCutAt,
    });

    await service.run(NOW);

    expect(complexRepo.update).toHaveBeenCalledWith('c1', {
      subscriptionAccessCutAt: accessCutAt,
      subscriptionPanicCutAt: NOW,
    });
  });

  describe('communityAccess', () => {
    it('sin corte y sin avisos no anuncia fecha', async () => {
      const { service } = build({ mode: 'access', overdueDays: 2 });

      await expect(service.communityAccess('c1', NOW)).resolves.toEqual({
        accessCut: false,
        panicAvailable: true,
        cutAt: null,
      });
    });

    it('con un aviso enviado anuncia la fecha para el banner', async () => {
      const { service } = build({
        mode: 'access',
        overdueDays: 10,
        rows: [{ milestone: 'ACCESS_N1', sentAt: NOW }],
      });

      const access = await service.communityAccess('c1', NOW);

      expect(access.accessCut).toBe(false);
      expect(access.cutAt).toEqual(new Date(NOW.getTime() + 20 * DAY));
    });

    it('con el modo apagado no informa corte aunque exista la marca', async () => {
      const { service } = build({
        mode: 'off',
        overdueDays: 40,
        accessCutAt: daysAgo(1),
      });

      await expect(service.communityAccess('c1', NOW)).resolves.toEqual({
        accessCut: false,
        panicAvailable: true,
        cutAt: null,
      });
    });

    it('cortado en modo access mantiene disponible el pánico', async () => {
      const cutAt = daysAgo(1);
      const { service } = build({
        mode: 'access',
        overdueDays: 40,
        accessCutAt: cutAt,
      });

      await expect(service.communityAccess('c1', NOW)).resolves.toEqual({
        accessCut: true,
        panicAvailable: true,
        cutAt,
      });
    });
  });
});
