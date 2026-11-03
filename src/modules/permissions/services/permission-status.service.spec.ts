import {
  PermissionStatusService,
  PERMISSION_STATUS_TTL_MS,
} from './permission-status.service';
import {
  inactivePermissions,
  resetInactivePermissions,
} from '../../shared/permission-status/permission-status.registry';

describe('PermissionStatusService', () => {
  const query = jest.fn();
  const cacheDelete = jest.fn(async () => undefined);
  const service = () =>
    new PermissionStatusService(
      { query, manager: { query } } as never,
      { delete: cacheDelete } as never,
    );

  beforeEach(() => {
    resetInactivePermissions();
    query.mockReset();
    cacheDelete.mockClear();
  });

  it('lee los inactivos de la base y los guarda 30 s', async () => {
    query.mockResolvedValue([{ name: 'IMPORT_GROWTH_DATA' }]);
    const s = service();
    const t0 = 1_000_000;
    expect([...(await s.inactive(t0))]).toEqual(['IMPORT_GROWTH_DATA']);
    await s.inactive(t0 + PERMISSION_STATUS_TTL_MS - 1);
    expect(query).toHaveBeenCalledTimes(1);
    await s.inactive(t0 + PERMISSION_STATUS_TTL_MS);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('muchas peticiones juntas hacen una sola lectura', async () => {
    query.mockResolvedValue([]);
    const s = service();
    await Promise.all([s.inactive(5), s.inactive(5), s.inactive(5)]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('invalidate obliga a leer de nuevo sin perder lo conocido', async () => {
    query.mockResolvedValueOnce([{ name: 'A' }]);
    const s = service();
    await s.inactive(10);
    s.invalidate();
    query.mockRejectedValueOnce(new Error('base caída'));
    // Falla al releer: sigue con lo último conocido (no se abre ni se cierra todo).
    expect([...(await s.inactive(20))]).toEqual(['A']);
    // Y no reintenta en cada petición: espera al siguiente TTL.
    await s.inactive(21);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('sin ningún dato, si la base falla, falla cerrado', async () => {
    query.mockRejectedValueOnce(new Error('base caída'));
    await expect(service().inactive(1)).rejects.toThrow('base caída');
    expect(inactivePermissions().size).toBe(0);
  });

  it('bumpHolders sube la versión de usuarios y complejos; afterCommit borra su caché y vence el estado', async () => {
    query
      .mockResolvedValueOnce([[{ id: 'u1' }, { id: 'u2' }], 2]) // UPDATE ... RETURNING
      .mockResolvedValueOnce([[{ id: 'c1' }], 1]);
    const s = service();
    const ids = await s.bumpHolders('perm-1');
    expect(ids).toEqual(['u1', 'u2', 'c1']);
    expect(query.mock.calls[0][0]).toMatch(
      /"tokenVersion" = u\."tokenVersion" \+ 1/,
    );
    expect(query.mock.calls[0][0]).toMatch(/user_permission_overrides/);
    expect(query.mock.calls[1][1]).toEqual(['perm-1', 'COMPLEX_ROL']);

    query.mockResolvedValueOnce([]);
    await s.inactive(100); // cargado
    await s.afterCommit(ids);
    expect(cacheDelete).toHaveBeenCalledTimes(3);
    query.mockResolvedValueOnce([{ name: 'X' }]);
    expect([...(await s.inactive(101))]).toEqual(['X']); // releyó tras afterCommit
  });
});
