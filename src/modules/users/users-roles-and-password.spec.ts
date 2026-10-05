import { UsersService } from './users.service';

// bcrypt nativo no hace falta para estas reglas.
jest.mock('bcrypt', () => ({ hash: jest.fn(async () => 'hashed') }));

/**
 * Reglas de cargo y contraseña:
 * - RESIDENT_ROL es el rol base: cambiar el cargo nunca lo quita;
 * - solo el SUPER_ADMIN asigna cargos de la plataforma, y COMPLEX_ROL no se le
 *   asigna a un usuario;
 * - la contraseña que asigna un administrador obliga a cambiarla al entrar.
 */

const ROLE_IDS: Record<string, string> = {
  RESIDENT_ROL: 'r-resident',
  COUNCIL_ROL: 'r-council',
  SECURITY_ROL: 'r-security',
  COMPILANCE_OFFICER_ROL: 'r-compliance',
  SUPER_ADMIN_ROL: 'r-super',
};

const userRole = (id: string, name: string, isPrimary = false) => ({
  id,
  isPrimary,
  role: { id: ROLE_IDS[name], name },
});

const superAdmin = { sub: 'admin-1', roles: ['SUPER_ADMIN_ROL'] };
const complexAccount = { sub: 'complex-1', roles: ['COMPLEX_ROL'] };

const build = (userRoles: ReturnType<typeof userRole>[]) => {
  const user = {
    id: 'user-1',
    email: 'ana@x.co',
    complexId: null,
    status: 'ACTIVE',
    userRoles,
  };

  const saved: Array<{ role: { id: string }; isPrimary: boolean }> = [];
  const deleted: string[][] = [];
  const qb = {
    update: jest.fn(() => qb),
    set: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    execute: jest.fn(async () => undefined),
  };
  const manager = {
    delete: jest.fn(async (_e: unknown, ids: string[]) => deleted.push(ids)),
    createQueryBuilder: jest.fn(() => qb),
    create: jest.fn((_e: unknown, v: unknown) => v),
    save: jest.fn(async (v: { role: { id: string }; isPrimary: boolean }) => {
      saved.push(v);
      return v;
    }),
    // ensureResidentRole
    findOne: jest.fn(async (entity: { name?: string }, opts: any) => {
      if (opts?.where?.name) return { id: ROLE_IDS[opts.where.name] };
      const roleId = opts?.where?.role?.id;
      return userRoles.some((ur) => ur.role.id === roleId) ? { id: 'x' } : null;
    }),
    count: jest.fn(async () => userRoles.length),
  };

  const userUpdate = jest.fn();
  const service = Object.create(UsersService.prototype) as UsersService;
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn() },
    userRepo: {
      findOne: jest.fn(async () => ({ ...user, mustChangePassword: true })),
      save: jest.fn(async (u: unknown) => u),
      update: userUpdate,
    },
    roleRepo: {
      findOne: jest.fn(async ({ where }: { where: { name: string } }) => ({
        id: ROLE_IDS[where.name],
        name: where.name,
      })),
    },
    dataSource: {
      transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)),
    },
    tokenService: { invalidateUserSessions: jest.fn() },
    notificationsService: { notifyProfileUpdated: jest.fn() },
    auditService: { log: jest.fn() },
    configService: { get: jest.fn(() => 4) },
  });

  return { service, saved, deleted, userUpdate };
};

describe('cargo del usuario (updateUser.role)', () => {
  it('un residente que recibe el cargo de oficial de cumplimiento sigue siendo residente', async () => {
    const h = build([userRole('ur-res', 'RESIDENT_ROL', true)]);

    await h.service.updateUser(
      { userId: 'user-1', role: 'COMPILANCE_OFFICER_ROL' },
      undefined,
      superAdmin as never,
    );

    expect(h.deleted).toEqual([]);
    expect(h.saved).toEqual([
      expect.objectContaining({
        role: { id: 'r-compliance' },
        isPrimary: true,
      }),
    ]);
  });

  it('cambiar de cargo reemplaza el anterior y conserva residente y consejo', async () => {
    const h = build([
      userRole('ur-sec', 'SECURITY_ROL', true),
      userRole('ur-res', 'RESIDENT_ROL'),
      userRole('ur-cou', 'COUNCIL_ROL'),
    ]);

    await h.service.updateUser(
      { userId: 'user-1', role: 'COMPILANCE_OFFICER_ROL' },
      undefined,
      superAdmin as never,
    );

    expect(h.deleted).toEqual([['ur-sec']]);
  });

  it('pedir RESIDENT_ROL quita el cargo y deja al residente', async () => {
    const h = build([
      userRole('ur-sec', 'SECURITY_ROL', true),
      userRole('ur-res', 'RESIDENT_ROL'),
    ]);

    await h.service.updateUser(
      { userId: 'user-1', role: 'RESIDENT_ROL' },
      undefined,
      superAdmin as never,
    );

    expect(h.deleted).toEqual([['ur-sec']]);
    expect(h.saved).toEqual([]);
  });

  it.each(['COMPILANCE_OFFICER_ROL', 'SUPER_ADMIN_ROL'])(
    'la cuenta de un complejo no puede asignar %s',
    async (role) => {
      const h = build([userRole('ur-res', 'RESIDENT_ROL', true)]);
      await expect(
        h.service.updateUser(
          { userId: 'user-1', role },
          undefined,
          complexAccount as never,
        ),
      ).rejects.toThrow('No puedes asignar ese rol');
    },
  );

  it('COMPLEX_ROL no se le asigna a un usuario, ni siquiera el SUPER_ADMIN', async () => {
    const h = build([userRole('ur-res', 'RESIDENT_ROL', true)]);
    await expect(
      h.service.updateUser(
        { userId: 'user-1', role: 'COMPLEX_ROL' },
        undefined,
        superAdmin as never,
      ),
    ).rejects.toThrow('No puedes asignar ese rol');
  });
});

describe('contraseña inicial', () => {
  it('el SUPER_ADMIN la asigna al oficial de cumplimiento y queda marcada para cambiar', async () => {
    const h = build([
      userRole('ur-comp', 'COMPILANCE_OFFICER_ROL', true),
      userRole('ur-res', 'RESIDENT_ROL'),
    ]);

    await h.service.adminResetUserPassword(
      { userId: 'user-1', newPassword: 'Inicial.123' },
      undefined,
      superAdmin as never,
    );

    expect(h.userUpdate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ mustChangePassword: true, passwordSet: true }),
    );
  });

  it('la cuenta de un complejo no puede asignarla a un oficial de cumplimiento', async () => {
    const h = build([userRole('ur-comp', 'COMPILANCE_OFFICER_ROL', true)]);
    await expect(
      h.service.adminResetUserPassword(
        { userId: 'user-1', newPassword: 'Inicial.123' },
        undefined,
        complexAccount as never,
      ),
    ).rejects.toThrow('Solo se puede restablecer');
  });

  it('un residente sin cargo no recibe contraseña', async () => {
    const h = build([userRole('ur-res', 'RESIDENT_ROL', true)]);
    await expect(
      h.service.adminResetUserPassword(
        { userId: 'user-1', newPassword: 'Inicial.123' },
        undefined,
        superAdmin as never,
      ),
    ).rejects.toThrow('no tiene un cargo que entre con contraseña');
  });

  it('cambiarla al entrar apaga la marca', async () => {
    const h = build([userRole('ur-comp', 'COMPILANCE_OFFICER_ROL', true)]);
    await h.service.completeRequiredPasswordChange('user-1', 'Nueva.Clave1');
    expect(h.userUpdate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ mustChangePassword: false }),
    );
  });
});
