import { AccessTokenValidatorService } from './services/access-token-validator.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { UsersService } from '../users/users.service';
import { SocketGateway } from '../../core/infrastructure/socket/socket.gateway';
import { UserStatus } from '../users/enums/user.enums';
import { AuthErrorCode } from '../shared/constans/error-codes.constants';
import { JwtAccessPayload } from './interfaces/jwt-payload.interface';

/**
 * Usuario suspendido: ningún token anterior sirve (HTTP, renovación ni
 * socket), y reactivarlo no devuelve las sesiones viejas.
 *
 * Fakes en memoria que imitan lo que la base y Redis hacen de verdad: la
 * versión del token vive en caché, las sesiones y los refresh tokens en tablas.
 */
type Row = {
  id: string;
  email: string;
  status: UserStatus;
  tokenVersion: number;
  suspensionReason: string | null;
  complexId: string;
  deletedAt: Date | null;
};

const build = () => {
  const user: Row = {
    id: 'user-1',
    email: 'ana@example.com',
    status: UserStatus.ACTIVE,
    tokenVersion: 0,
    suspensionReason: null,
    complexId: 'complex-1',
    deletedAt: null,
  };
  const versionCache = new Map<string, number>();
  const sessions = new Map<string, 'active' | 'logged_out'>([
    ['s-web', 'active'],
    ['s-app', 'active'],
  ]);
  const refreshRevoked = new Set<string>();
  const disconnected: string[] = [];
  const audit: any[] = [];

  const userRepo = {
    findOne: jest.fn(async () => ({ ...user })),
    findOneOrFail: jest.fn(async () => ({ ...user })),
    update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'tokenVersion' && typeof v === 'function') {
          user.tokenVersion += 1;
        } else {
          (user as any)[k] = v;
        }
      }
    }),
  };

  const tokenService = {
    getUserTokenVersion: jest.fn(
      async (id: string) => versionCache.get(id) ?? null,
    ),
    setUserTokenVersion: jest.fn(async (id: string, v: number) => {
      versionCache.set(id, v);
    }),
    clearUserTokenVersionCache: jest.fn(async (id: string) => {
      versionCache.delete(id);
    }),
    invalidateUserSessions: jest.fn(async (id: string) => {
      for (const s of sessions.keys()) refreshRevoked.add(s);
      versionCache.delete(id);
    }),
  } as unknown as TokenService;

  const sessionService = {
    isSessionActive: jest.fn(
      async (id: string) => sessions.get(id) === 'active',
    ),
    terminateAllUserSessions: jest.fn(async () => {
      let n = 0;
      for (const [k, v] of sessions) {
        if (v === 'active') {
          sessions.set(k, 'logged_out');
          refreshRevoked.add(k);
          n++;
        }
      }
      return n;
    }),
  } as unknown as SessionService;

  const validator = new AccessTokenValidatorService(
    tokenService,
    sessionService,
    userRepo as never,
    { findOne: jest.fn() } as never,
  );

  const usersService = Object.create(UsersService.prototype) as UsersService;
  Object.assign(usersService, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    userRepo,
    tokenService,
    sessionService,
    socketService: {
      disconnectUser: jest.fn((id: string) => disconnected.push(id)),
    },
    auditService: { log: jest.fn((e: unknown) => audit.push(e)) },
  });

  const tokenFor = (sessionId: string): JwtAccessPayload =>
    ({
      sub: user.id,
      email: user.email,
      type: 'access',
      entityType: 'user',
      tokenVersion: user.tokenVersion,
      sessionId,
      roles: [],
      permissions: [],
      complexId: user.complexId,
    }) as JwtAccessPayload;

  const admin = {
    sub: 'admin-1',
    email: 'admin@example.com',
    roles: ['COMPLEX_ROL'],
  } as unknown as JwtAccessPayload;

  return {
    user,
    sessions,
    versionCache,
    refreshRevoked,
    disconnected,
    audit,
    validator,
    usersService,
    tokenFor,
    admin,
  };
};

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e: any) {
    return e?.errorCode ?? e?.extensions?.code ?? e?.message;
  }
};

describe('Usuario suspendido: acceso de punta a punta', () => {
  it('usuario activo: el token vigente pasa', async () => {
    const h = build();
    await expect(
      h.validator.validate(h.tokenFor('s-web')),
    ).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('suspendido con token vigente: rechazado aunque la versión estuviera en caché', async () => {
    const h = build();
    const token = h.tokenFor('s-web');
    await h.validator.validate(token); // deja la versión 0 en caché

    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);

    expect(h.user.status).toBe(UserStatus.SUSPENDED);
    expect(h.user.tokenVersion).toBe(1);
    expect(h.versionCache.has('user-1')).toBe(false);
    // Sin caché, la base dice «suspendido».
    expect(await codeOf(h.validator.validate(token))).toBe(
      AuthErrorCode.SESSION_TERMINATED,
    );
  });

  it('suspendido con la versión nueva en caché: el token viejo choca con la versión', async () => {
    const h = build();
    const token = h.tokenFor('s-web');
    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);
    h.versionCache.set('user-1', h.user.tokenVersion);

    expect(await codeOf(h.validator.validate(token))).toBe(
      AuthErrorCode.SESSION_EXPIRED,
    );
  });

  it('varias sesiones: suspender las cierra todas, revoca sus refresh y corta los sockets', async () => {
    const h = build();
    const web = h.tokenFor('s-web');
    const app = h.tokenFor('s-app');

    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);

    expect([...h.sessions.values()]).toEqual(['logged_out', 'logged_out']);
    expect([...h.refreshRevoked].sort()).toEqual(['s-app', 's-web']);
    expect(h.disconnected).toEqual(['user-1']);
    expect(await codeOf(h.validator.validate(web))).not.toBe('OK');
    expect(await codeOf(h.validator.validate(app))).not.toBe('OK');
  });

  it('queda auditado con el estado anterior y las sesiones cerradas', async () => {
    const h = build();
    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);

    expect(h.audit).toHaveLength(1);
    expect(h.audit[0]).toMatchObject({
      action: 'SUSPEND',
      entityId: 'user-1',
      performedById: 'admin-1',
      previousValue: { status: UserStatus.ACTIVE },
      newValue: {
        status: UserStatus.SUSPENDED,
        sessionsClosed: 2,
        sessionsCutComplete: true,
      },
    });
  });

  it('si Redis falla al cortar, la suspensión queda hecha y la auditoría lo dice', async () => {
    const h = build();
    (h.usersService as any).sessionService.terminateAllUserSessions = jest.fn(
      async () => {
        throw new Error('redis caído');
      },
    );
    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);

    expect(h.user.status).toBe(UserStatus.SUSPENDED);
    expect(h.user.tokenVersion).toBe(1);
    expect(h.audit[0].newValue.sessionsCutComplete).toBe(false);
  });

  it('reactivado con el token anterior: sigue rechazado', async () => {
    const h = build();
    const old = h.tokenFor('s-web');
    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);
    await h.usersService.reactivateUser('user-1', undefined, h.admin);

    expect(h.user.status).toBe(UserStatus.ACTIVE);
    expect(h.user.tokenVersion).toBe(2);
    expect(await codeOf(h.validator.validate(old))).toBe(
      AuthErrorCode.SESSION_EXPIRED,
    );
  });

  it('reactivado con una sesión nueva: pasa', async () => {
    const h = build();
    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);
    await h.usersService.reactivateUser('user-1', undefined, h.admin);
    h.sessions.set('s-nueva', 'active'); // login nuevo
    await expect(
      h.validator.validate(h.tokenFor('s-nueva')),
    ).resolves.toMatchObject({ sessionId: 's-nueva' });
  });

  it('suspensión con una sesión activa en uso: la petición siguiente ya no pasa', async () => {
    const h = build();
    const token = h.tokenFor('s-app');
    expect(await codeOf(h.validator.validate(token))).toBe('OK');
    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);
    expect(await codeOf(h.validator.validate(token))).not.toBe('OK');
  });

  it.each([
    UserStatus.BANNED,
    UserStatus.INACTIVE,
    UserStatus.PENDING_VERIFICATION,
    UserStatus.DELETED,
  ])('estado %s: la sesión abierta tampoco sirve', async (status) => {
    const h = build();
    h.user.status = status;
    expect(await codeOf(h.validator.validate(h.tokenFor('s-web')))).toBe(
      AuthErrorCode.SESSION_TERMINATED,
    );
  });
});

describe('Usuario suspendido: Socket.IO', () => {
  const connect = async (validator: AccessTokenValidatorService) => {
    let middleware: any;
    const server = { use: (fn: unknown) => (middleware = fn) };
    const gateway = new SocketGateway(
      {
        verifyAccessToken: jest.fn(async (t: string) => JSON.parse(t)),
      } as never,
      validator,
      { setServer: jest.fn() } as never,
      {} as never,
    );
    (gateway as any).logger = { log: jest.fn(), warn: jest.fn() };
    gateway.afterInit(server as never);
    return (payload: JwtAccessPayload) =>
      new Promise<string>((resolve) => {
        const client = {
          id: 'sock-1',
          handshake: { auth: { token: JSON.stringify(payload) }, headers: {} },
          data: {} as Record<string, unknown>,
          join: jest.fn(async () => undefined),
        };
        void middleware(client, (err?: Error) =>
          resolve(err ? err.message : 'OK'),
        );
      });
  };

  it('activo: conecta', async () => {
    const h = build();
    const open = await connect(h.validator);
    expect(await open(h.tokenFor('s-web'))).toBe('OK');
  });

  it('suspendido: el handshake con el token viejo se rechaza', async () => {
    const h = build();
    const open = await connect(h.validator);
    const token = h.tokenFor('s-web');
    await h.usersService.suspendUser('user-1', 'sanción', undefined, h.admin);
    expect(await open(token)).toBe('No autorizado');
  });

  it('token anterior a un cambio de versión: rechazado (antes solo se miraba la sesión)', async () => {
    const h = build();
    const open = await connect(h.validator);
    const token = h.tokenFor('s-web');
    h.user.tokenVersion = 7; // p. ej. cambio de rol o de clave
    expect(await open(token)).toBe('No autorizado');
  });
});
