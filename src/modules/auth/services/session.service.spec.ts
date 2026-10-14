import { In } from 'typeorm';
import { SessionService } from './session.service';
import { SessionStatus } from '../entities/user-session.entity';

describe('SessionService — cerrar una sesión revoca sus refresh tokens', () => {
  const build = (activeSessions: { id: string }[] = []) => {
    const sessionRepo = {
      update: jest.fn(async () => ({ affected: 1 })),
      find: jest.fn(async () => activeSessions),
    };
    const refreshTokenRepo = { update: jest.fn(async () => ({ affected: 1 })) };
    const cacheService = { delete: jest.fn(async () => undefined) };
    const service = new SessionService(
      sessionRepo as never,
      refreshTokenRepo as never,
      cacheService as never,
    );
    return { service, sessionRepo, refreshTokenRepo };
  };

  it('terminateSession revoca los refresh tokens de esa sesión', async () => {
    const { service, refreshTokenRepo } = build();

    await service.terminateSession('sess-1');

    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { sessionId: In(['sess-1']), isRevoked: false },
      { isRevoked: true, revokedReason: 'session_terminated' },
    );
  });

  it('enforceSessionLimit revoca los refresh tokens de las sesiones que expulsa', async () => {
    const { service, sessionRepo, refreshTokenRepo } = build();
    sessionRepo.find.mockResolvedValueOnce([
      { id: 'vieja' },
      { id: 'nueva' },
    ] as never);

    await service.enforceSessionLimit('user-1', 2);

    expect(sessionRepo.update).toHaveBeenCalledWith('vieja', {
      status: SessionStatus.LOGGED_OUT,
    });
    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { sessionId: In(['vieja']), isRevoked: false },
      { isRevoked: true, revokedReason: 'session_terminated' },
    );
  });

  it('terminateOtherSessions no toca refresh tokens si no hay otras sesiones', async () => {
    const { service, refreshTokenRepo } = build([]);

    await service.terminateOtherSessions('user-1', 'actual');

    expect(refreshTokenRepo.update).not.toHaveBeenCalled();
  });
});
