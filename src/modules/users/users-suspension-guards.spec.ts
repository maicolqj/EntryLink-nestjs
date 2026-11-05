import { UsersService } from './users.service';
import { UserStatus } from './enums/user.enums';
import { UserErrorCode } from '../shared/constans/error-codes.constants';
import { ValidRoles } from '../roles/enums/valid-roles';
import { JwtAccessPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * Nadie se suspende a sí mismo, solo un SUPER_ADMIN suspende a otro, nunca al
 * último activo, y SUPER_ADMIN no queda atado al complejo de su sesión.
 *
 * El 2026-11-05 el único SUPER_ADMIN se suspendió a sí mismo, la reactivación
 * desde la web falló por el chequeo de complejo y hubo que corregirlo por SQL.
 */
type Target = {
  id: string;
  email: string;
  status: UserStatus;
  complexId: string | null;
  isSuperAdmin: boolean;
};

const build = (target: Target, otherActiveSuperAdmins: number) => {
  const row = { ...target, tokenVersion: 0, suspensionReason: null };

  const userRepo = {
    findOne: jest.fn(async () => ({ ...row })),
    findOneOrFail: jest.fn(async () => ({ ...row })),
    update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v !== 'function') (row as any)[k] = v;
      }
    }),
    createQueryBuilder: jest.fn(() => {
      const clauses: string[] = [];
      const qb: any = {
        innerJoin: () => qb,
        where: (c: string) => (clauses.push(c), qb),
        andWhere: (c: string) => (clauses.push(c), qb),
        getCount: async () => {
          if (clauses.includes('u.id = :userId')) {
            return target.isSuperAdmin ? 1 : 0;
          }
          return otherActiveSuperAdmins;
        },
      };
      return qb;
    }),
  };

  const service = Object.create(UsersService.prototype) as UsersService;
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    userRepo,
    tokenService: {
      invalidateUserSessions: jest.fn(async () => undefined),
      clearUserTokenVersionCache: jest.fn(async () => undefined),
    },
    sessionService: { terminateAllUserSessions: jest.fn(async () => 1) },
    socketService: { disconnectUser: jest.fn() },
    auditService: { log: jest.fn() },
  });

  return { service, row, userRepo };
};

const superAdmin = (sub: string, complexId?: string) =>
  ({
    sub,
    email: `${sub}@example.com`,
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL],
    complexId,
  }) as unknown as JwtAccessPayload;

const complexAccount = (complexId: string) =>
  ({
    sub: complexId,
    email: 'conjunto@example.com',
    roles: [ValidRoles.COMPLEX_ROL],
    complexId,
  }) as unknown as JwtAccessPayload;

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e: any) {
    return e?.errorCode ?? e?.message;
  }
};

const adminTarget = (id: string, status = UserStatus.ACTIVE): Target => ({
  id,
  email: `${id}@example.com`,
  status,
  complexId: null,
  isSuperAdmin: true,
});

describe('suspendUser: protecciones', () => {
  it('nadie puede suspender su propia cuenta', async () => {
    const { service, row } = build(adminTarget('sa-1'), 1);

    const code = await codeOf(
      service.suspendUser('sa-1', 'PRUEBA', undefined, superAdmin('sa-1')),
    );

    expect(code).toBe(UserErrorCode.CANNOT_SUSPEND_SELF);
    expect(row.status).toBe(UserStatus.ACTIVE);
  });

  it('tampoco un residente o una cuenta de complejo sobre sí misma', async () => {
    const { service } = build(
      {
        id: 'cx-1',
        email: 'c@example.com',
        status: UserStatus.ACTIVE,
        complexId: 'cx-1',
        isSuperAdmin: false,
      },
      1,
    );

    expect(
      await codeOf(
        service.suspendUser('cx-1', 'x', 'cx-1', complexAccount('cx-1')),
      ),
    ).toBe(UserErrorCode.CANNOT_SUSPEND_SELF);
  });

  it('no se puede suspender al último SUPER_ADMIN activo', async () => {
    const { service, row } = build(adminTarget('sa-2'), 0);

    const code = await codeOf(
      service.suspendUser('sa-2', 'x', undefined, superAdmin('sa-1')),
    );

    expect(code).toBe(UserErrorCode.LAST_SUPER_ADMIN);
    expect(row.status).toBe(UserStatus.ACTIVE);
  });

  it('con otro SUPER_ADMIN activo, un SUPER_ADMIN sí puede suspender a otro', async () => {
    const { service, row } = build(adminTarget('sa-2'), 1);

    await service.suspendUser('sa-2', 'x', undefined, superAdmin('sa-1'));

    expect(row.status).toBe(UserStatus.SUSPENDED);
  });

  it('una cuenta que no es SUPER_ADMIN no puede suspender a un SUPER_ADMIN', async () => {
    const { service, row } = build(
      { ...adminTarget('sa-2'), complexId: 'cx-1' },
      3,
    );

    const code = await codeOf(
      service.suspendUser('sa-2', 'x', 'cx-1', complexAccount('cx-1')),
    );

    expect(code).toBe(UserErrorCode.CANNOT_SUSPEND_SUPER_ADMIN);
    expect(row.status).toBe(UserStatus.ACTIVE);
  });

  it('SUPER_ADMIN con complexId en la sesión suspende a alguien de otro complejo', async () => {
    const { service, row } = build(
      {
        id: 'res-1',
        email: 'r@example.com',
        status: UserStatus.ACTIVE,
        complexId: 'cx-2',
        isSuperAdmin: false,
      },
      0,
    );

    await service.suspendUser('res-1', 'x', 'cx-1', superAdmin('sa-1', 'cx-1'));

    expect(row.status).toBe(UserStatus.SUSPENDED);
  });

  it('una cuenta de complejo sigue sin poder suspender usuarios de otro complejo', async () => {
    const { service } = build(
      {
        id: 'res-1',
        email: 'r@example.com',
        status: UserStatus.ACTIVE,
        complexId: 'cx-2',
        isSuperAdmin: false,
      },
      0,
    );

    expect(
      await codeOf(
        service.suspendUser('res-1', 'x', 'cx-1', complexAccount('cx-1')),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('reactivateUser: SUPER_ADMIN no queda atado al complejo de su sesión', () => {
  it('reactiva a un SUPER_ADMIN (complex_id NULL) aunque su sesión traiga complexId', async () => {
    const { service, row } = build(
      adminTarget('sa-2', UserStatus.SUSPENDED),
      0,
    );

    await service.reactivateUser('sa-2', 'cx-1', superAdmin('sa-1', 'cx-1'));

    expect(row.status).toBe(UserStatus.ACTIVE);
  });

  it('una cuenta de complejo sigue sin poder reactivar usuarios de otro complejo', async () => {
    const { service } = build(
      {
        id: 'res-1',
        email: 'r@example.com',
        status: UserStatus.SUSPENDED,
        complexId: 'cx-2',
        isSuperAdmin: false,
      },
      0,
    );

    expect(
      await codeOf(
        service.reactivateUser('res-1', 'cx-1', complexAccount('cx-1')),
      ),
    ).toBe('FORBIDDEN');
  });
});
