import {
  PermissionStatusService,
  PERMISSION_STATUS_MAX_STALE_MS,
  PERMISSION_STATUS_QUERY_TIMEOUT_MS,
  PERMISSION_STATUS_RETRY_MS,
  PERMISSION_STATUS_TTL_MS,
} from './permission-status.service';
import {
  isPermissionInactive,
  permissionStatusTrusted,
  resetInactivePermissions,
} from '../../shared/permission-status/permission-status.registry';

const S = 1000;
const T0 = 10_000_000;

/** La base: lo que devuelve cada lectura, o que falla, o que no responde. */
function fakeDb() {
  const state = {
    inactive: [] as string[],
    mode: 'ok' as 'ok' | 'down' | 'hang',
    reads: 0,
  };
  const query = jest.fn(() => {
    state.reads++;
    if (state.mode === 'down') return Promise.reject(new Error('ECONNREFUSED'));
    if (state.mode === 'hang') return new Promise(() => undefined);
    return Promise.resolve(state.inactive.map((name) => ({ name })));
  });
  return { state, ds: { query, manager: { query } } };
}

const newService = (db: ReturnType<typeof fakeDb>) =>
  new PermissionStatusService(db.ds as never, { delete: jest.fn() } as never);

const unavailable = { errorCode: 'PERMISSION_STATUS_UNAVAILABLE' };

describe('PermissionStatusService — estado vigente y antigüedad máxima', () => {
  beforeEach(() => resetInactivePermissions());
  afterEach(() => jest.useRealTimers());

  it('las constantes: TTL 30 s, reintento 5 s, límite de la consulta 5 s, antigüedad máxima 120 s', () => {
    expect([
      PERMISSION_STATUS_TTL_MS,
      PERMISSION_STATUS_RETRY_MS,
      PERMISSION_STATUS_QUERY_TIMEOUT_MS,
      PERMISSION_STATUS_MAX_STALE_MS,
    ]).toEqual([30 * S, 5 * S, 5 * S, 120 * S]);
  });

  it('1. lectura correcta: devuelve los inactivos y no vuelve a leer dentro del TTL', async () => {
    const db = fakeDb();
    db.state.inactive = ['IMPORT_GROWTH_DATA'];
    const s = newService(db);
    expect([...(await s.inactive(T0))]).toEqual(['IMPORT_GROWTH_DATA']);
    await s.inactive(T0 + 29 * S);
    expect(db.state.reads).toBe(1);
    expect(permissionStatusTrusted(T0 + 29 * S)).toBe(true);
  });

  it('2. desactivado con la app andando: con el servicio se ve al momento; por SQL, al vencer el TTL', async () => {
    const db = fakeDb();
    const s = newService(db);
    await s.inactive(T0);
    db.state.inactive = ['X'];
    // Sin invalidar (cambio por SQL): sigue lo anterior hasta el TTL.
    expect([...(await s.inactive(T0 + 10 * S))]).toEqual([]);
    expect([...(await s.inactive(T0 + 30 * S))]).toEqual(['X']);
    // Con el servicio (invalidate): al momento.
    db.state.inactive = ['Y'];
    s.invalidate();
    expect([...(await s.inactive(T0 + 31 * S))]).toEqual(['Y']);
  });

  it('3. caché vencida y la base cae: sigue lo último verificado y reintenta cada 5 s, no en cada petición', async () => {
    const db = fakeDb();
    db.state.inactive = ['A'];
    const s = newService(db);
    await s.inactive(T0);
    db.state.mode = 'down';
    expect([...(await s.inactive(T0 + 31 * S))]).toEqual(['A']);
    expect(db.state.reads).toBe(2);
    await s.inactive(T0 + 32 * S);
    await s.inactive(T0 + 35 * S);
    expect(db.state.reads).toBe(2); // dentro de los 5 s: sin otra lectura
    await s.inactive(T0 + 36 * S + 1);
    expect(db.state.reads).toBe(3);
  });

  it('4. más de 30 s sin base (pero menos de 120 s): sigue autorizando con lo verificado', async () => {
    const db = fakeDb();
    db.state.inactive = ['A'];
    const s = newService(db);
    await s.inactive(T0);
    db.state.mode = 'down';
    expect([...(await s.inactive(T0 + 90 * S))]).toEqual(['A']);
    expect(isPermissionInactive('B', T0 + 90 * S)).toBe(false);
  });

  it('5. varios minutos sin base: pasado 120 s se niega todo (503), también en actorHas', async () => {
    const db = fakeDb();
    const s = newService(db);
    await s.inactive(T0);
    db.state.mode = 'down';
    await expect(s.inactive(T0 + 120 * S)).rejects.toMatchObject(unavailable);
    await expect(s.inactive(T0 + 5 * 60 * S)).rejects.toMatchObject(
      unavailable,
    );
    // Las verificaciones síncronas (actorHas) tampoco confían.
    expect(isPermissionInactive('CUALQUIERA', T0 + 120 * S)).toBe(true);
    expect(permissionStatusTrusted(T0 + 120 * S)).toBe(false);
  });

  it('6. al volver la base, vuelve a autorizar con el estado recién leído', async () => {
    const db = fakeDb();
    const s = newService(db);
    await s.inactive(T0);
    db.state.mode = 'down';
    await expect(s.inactive(T0 + 200 * S)).rejects.toMatchObject(unavailable);
    db.state.mode = 'ok';
    db.state.inactive = ['Z'];
    expect([...(await s.inactive(T0 + 206 * S))]).toEqual(['Z']);
    expect(isPermissionInactive('OTRO', T0 + 206 * S)).toBe(false);
  });

  it('nunca verificado y la base cae: se niega desde el primer momento', async () => {
    const db = fakeDb();
    db.state.mode = 'down';
    await expect(newService(db).inactive(T0)).rejects.toMatchObject(
      unavailable,
    );
    expect(isPermissionInactive('X', T0)).toBe(true);
  });

  it('la base no responde (consulta colgada): a los 5 s cuenta como fallo y no deja peticiones esperando', async () => {
    jest.useFakeTimers();
    const db = fakeDb();
    db.state.mode = 'hang';
    const pending = newService(db).inactive(T0);
    const assertion = expect(pending).rejects.toMatchObject(unavailable);
    await jest.advanceTimersByTimeAsync(PERMISSION_STATUS_QUERY_TIMEOUT_MS);
    await assertion;
  });

  it('muchas peticiones juntas hacen una sola lectura', async () => {
    const db = fakeDb();
    const s = newService(db);
    await Promise.all([s.inactive(T0), s.inactive(T0), s.inactive(T0)]);
    expect(db.state.reads).toBe(1);
  });

  it('al arrancar lee una vez y luego cada 30 s aunque no haya peticiones', async () => {
    jest.useFakeTimers();
    const db = fakeDb();
    const s = newService(db);
    s.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(db.state.reads).toBe(1);
    await jest.advanceTimersByTimeAsync(PERMISSION_STATUS_TTL_MS);
    expect(db.state.reads).toBe(2);
    s.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(PERMISSION_STATUS_TTL_MS * 3);
    expect(db.state.reads).toBe(2);
  });

  it('7. varias instancias: cada una tiene su caché; un cambio por el servicio en una se ve en las demás al vencer su TTL', async () => {
    // Dos copias aisladas del módulo = dos procesos con su propio registro.
    const load = () => {
      let mod!: typeof import('./permission-status.service');
      let reg!: typeof import('../../shared/permission-status/permission-status.registry');
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require('./permission-status.service');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        reg = require('../../shared/permission-status/permission-status.registry');
      });
      reg.resetInactivePermissions();
      return { mod, reg };
    };
    const a = load();
    const b = load();
    const db = fakeDb();
    const sa = new a.mod.PermissionStatusService(
      db.ds as never,
      { delete: jest.fn() } as never,
    );
    const sb = new b.mod.PermissionStatusService(
      db.ds as never,
      { delete: jest.fn() } as never,
    );
    await sa.inactive(T0);
    await sb.inactive(T0);
    db.state.inactive = ['X'];
    sa.invalidate(); // el cambio se hizo en la instancia A
    expect([...(await sa.inactive(T0 + S))]).toEqual(['X']);
    expect([...(await sb.inactive(T0 + S))]).toEqual([]); // B aún no
    expect([...(await sb.inactive(T0 + 30 * S))]).toEqual(['X']); // B al vencer su TTL
    // Cada una falla cerrado por su cuenta: A verificó en T0+1 s, B en T0+30 s.
    db.state.mode = 'down';
    await expect(sa.inactive(T0 + 121 * S + 1)).rejects.toMatchObject(
      unavailable,
    );
    expect(b.reg.permissionStatusTrusted(T0 + 140 * S)).toBe(true);
    await expect(sb.inactive(T0 + 150 * S + 1)).rejects.toMatchObject(
      unavailable,
    );
  });

  it('bumpHolders sube la versión de usuarios y complejos; afterCommit borra su caché y pide releer', async () => {
    const query = jest.fn();
    const cacheDelete = jest.fn(async () => undefined);
    const s = new PermissionStatusService(
      { query, manager: { query } } as never,
      { delete: cacheDelete } as never,
    );
    query
      .mockResolvedValueOnce([[{ id: 'u1' }, { id: 'u2' }], 2])
      .mockResolvedValueOnce([[{ id: 'c1' }], 1]);
    const ids = await s.bumpHolders('perm-1');
    expect(ids).toEqual(['u1', 'u2', 'c1']);
    expect(query.mock.calls[0][0]).toMatch(
      /"tokenVersion" = u\."tokenVersion" \+ 1/,
    );
    expect(query.mock.calls[0][0]).toMatch(/user_permission_overrides/);
    expect(query.mock.calls[1][1]).toEqual(['perm-1', 'COMPLEX_ROL']);
    query.mockResolvedValueOnce([]);
    await s.inactive(T0);
    await s.afterCommit(ids);
    expect(cacheDelete).toHaveBeenCalledTimes(3);
    query.mockResolvedValueOnce([{ name: 'X' }]);
    expect([...(await s.inactive(T0 + S))]).toEqual(['X']);
  });
});
