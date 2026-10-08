import { SecurityAppExitsService } from './security-app-exits.service';
import { SecurityAppExit } from '../entities/security-app-exit.entity';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { SecurityAppExitErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const COMPLEX_ID = '11111111-1111-1111-1111-111111111111';
const GUARD_ID = '22222222-2222-2222-2222-222222222222';

const guard = (complexId: string | null = COMPLEX_ID): JwtAccessPayload => ({
  sub: GUARD_ID,
  email: 'guarda@example.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles: [ValidRoles.SECURITY_ROL],
  permissions: [],
  complexId: complexId ?? undefined,
});

function setup(options?: {
  open?: Partial<SecurityAppExit> | null;
  alertEnabled?: boolean;
  alertMinutes?: number;
}) {
  const open = options?.open ?? null;

  const exitRepo = {
    findOne: jest.fn().mockResolvedValue(open),
    create: jest.fn((data: Partial<SecurityAppExit>) => data),
    save: jest.fn((data: Partial<SecurityAppExit>) =>
      Promise.resolve({ id: 'exit-1', ...data }),
    ),
    find: jest.fn().mockResolvedValue([
      {
        id: 'exit-1',
        complexId: COMPLEX_ID,
        guardId: GUARD_ID,
        leftAt: new Date(),
        guard: { fullName: 'PEDRO PÉREZ' },
      },
    ]),
    manager: {
      query: jest.fn().mockResolvedValue([[{ id: 'exit-1' }], 1]),
    },
  };
  const complexRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: COMPLEX_ID,
      guardExitAlertEnabled: options?.alertEnabled ?? false,
      guardExitAlertMinutes: options?.alertMinutes ?? 0,
    }),
  };
  const notificationsService = { notify: jest.fn().mockResolvedValue([]) };
  const socketService = { emitToComplex: jest.fn() };

  const service = new SecurityAppExitsService(
    exitRepo as never,
    complexRepo as never,
    {} as never,
    notificationsService as never,
    socketService as never,
  );

  return { service, exitRepo, notificationsService, socketService };
}

describe('SecurityAppExitsService', () => {
  describe('reportBackground', () => {
    it('abre la salida con el conjunto del token y avisa a la web', async () => {
      const { service, exitRepo, socketService } = setup();

      const exit = await service.reportBackground({}, guard());

      expect(exitRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ complexId: COMPLEX_ID, guardId: GUARD_ID }),
      );
      expect(exit.id).toBe('exit-1');
      expect(socketService.emitToComplex).toHaveBeenCalledWith(
        COMPLEX_ID,
        SocketEvent.SECURITY_APP_EXIT_UPDATED,
        { complexId: COMPLEX_ID },
      );
    });

    it('no duplica la salida si ya hay una abierta', async () => {
      const open = { id: 'open-1', guardId: GUARD_ID, leftAt: new Date() };
      const { service, exitRepo } = setup({ open });

      const exit = await service.reportBackground({}, guard());

      expect(exit).toBe(open);
      expect(exitRepo.save).not.toHaveBeenCalled();
    });

    it('con el aviso apagado no notifica a la administración', async () => {
      const { service, notificationsService } = setup({ alertEnabled: false });

      await service.reportBackground({}, guard());

      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('con el aviso en 0 minutos notifica de inmediato a la cuenta del conjunto', async () => {
      const { service, notificationsService } = setup({
        alertEnabled: true,
        alertMinutes: 0,
      });

      await service.reportBackground({}, guard());
      await new Promise((resolve) => setImmediate(resolve));

      expect(notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.SECURITY_APP_EXIT,
          userIds: [COMPLEX_ID],
          complexId: COMPLEX_ID,
        }),
      );
    });

    it('con margen en minutos deja el aviso al cron', async () => {
      const { service, notificationsService } = setup({
        alertEnabled: true,
        alertMinutes: 5,
      });

      await service.reportBackground({}, guard());

      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('rechaza un vigilante sin conjunto en el token', async () => {
      const { service } = setup();

      await expect(
        service.reportBackground({}, guard(null)),
      ).rejects.toMatchObject({
        errorCode: SecurityAppExitErrorCode.SECURITY_APP_EXIT_NO_COMPLEX,
      });
    });

    it('rechaza una hora del equipo en el futuro', async () => {
      const { service } = setup();
      const future = new Date(Date.now() + 10 * 60 * 1000);

      await expect(
        service.reportBackground({ occurredAt: future }, guard()),
      ).rejects.toMatchObject({
        errorCode: SecurityAppExitErrorCode.SECURITY_APP_EXIT_INVALID_TIME,
      });
    });

    it('acepta un evento en cola de hace unos minutos con su hora', async () => {
      const { service, exitRepo } = setup();
      const queued = new Date(Date.now() - 5 * 60 * 1000);

      await service.reportBackground({ occurredAt: queued }, guard());

      expect(exitRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ leftAt: queued }),
      );
    });
  });

  describe('reportForeground', () => {
    it('cierra la salida abierta con la duración', async () => {
      const leftAt = new Date(Date.now() - 90 * 1000);
      const { service } = setup({
        open: {
          id: 'open-1',
          complexId: COMPLEX_ID,
          guardId: GUARD_ID,
          leftAt,
        },
      });

      const exit = await service.reportForeground({}, guard());

      expect(exit?.returnedAt).toBeInstanceOf(Date);
      expect(exit?.durationSeconds).toBeGreaterThanOrEqual(90);
    });

    it('devuelve null si no había salida abierta', async () => {
      const { service, exitRepo } = setup({ open: null });

      await expect(service.reportForeground({}, guard())).resolves.toBeNull();
      expect(exitRepo.save).not.toHaveBeenCalled();
    });

    it('un regreso en cola anterior a la salida no deja duración negativa', async () => {
      const leftAt = new Date(Date.now() - 60 * 1000);
      const { service } = setup({
        open: {
          id: 'open-1',
          complexId: COMPLEX_ID,
          guardId: GUARD_ID,
          leftAt,
        },
      });

      const exit = await service.reportForeground(
        { occurredAt: new Date(leftAt.getTime() - 30 * 1000) },
        guard(),
      );

      expect(exit?.durationSeconds).toBe(0);
    });
  });

  describe('sendAlerts', () => {
    it('no notifica las salidas que otro proceso ya reclamó', async () => {
      const { service, exitRepo, notificationsService } = setup();
      exitRepo.manager.query.mockResolvedValueOnce([[], 0]);

      await expect(service.sendAlerts(['exit-1'])).resolves.toBe(0);
      expect(notificationsService.notify).not.toHaveBeenCalled();
    });
  });
});
