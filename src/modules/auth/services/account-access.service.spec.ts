import { AccountAccessService } from './account-access.service';

describe('AccountAccessService.forceRelogin', () => {
  const build = (failSessions = false) => {
    const calls: string[] = [];
    const service = new AccountAccessService(
      {
        update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
          if (typeof patch.tokenVersion === 'function') calls.push('version');
        }),
      } as never,
      {
        terminateAllUserSessions: jest.fn(async () => {
          if (failSessions) throw new Error('redis caído');
          calls.push('sessions');
          return 3;
        }),
      } as never,
      {
        invalidateUserSessions: jest.fn(async () => {
          calls.push('refresh');
        }),
      } as never,
      { disconnectUser: jest.fn(() => calls.push('sockets')) } as never,
    );
    return { service, calls };
  };

  it('sube la versión primero y después cierra sesiones, refresh y sockets', async () => {
    const { service, calls } = build();

    const res = await service.forceRelogin('user-1', 'resident_suspended');

    expect(calls).toEqual(['version', 'sessions', 'refresh', 'sockets']);
    expect(res).toEqual({ closed: 3, complete: true });
  });

  it('si una parte falla, sigue con las demás y lo informa', async () => {
    const { service, calls } = build(true);

    const res = await service.forceRelogin('user-1', 'resident_suspended');

    expect(calls).toEqual(['version', 'refresh', 'sockets']);
    expect(res).toEqual({ closed: 0, complete: false });
  });
});
