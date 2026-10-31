import { UsersService } from './users.service';

jest.mock('bcrypt', () => ({ hash: jest.fn(async () => 'hashed') }));

/**
 * Los roles de la Growth Suite nacen inactivos y no se pueden asignar hasta
 * activarlos. `assignJobRole` y `createAdminUser` no miraban `role.status`, así
 * que sin este bloqueo un SUPER_ADMIN podía asignarlos y llegaban al JWT.
 */

const superAdmin = { sub: 'admin-1', roles: ['SUPER_ADMIN_ROL'] };

const build = (roleStatus: Record<string, boolean>) => {
  const user = {
    id: 'user-1',
    email: 'ventas@alternaqj.com',
    complexId: null,
    status: 'ACTIVE',
    userRoles: [
      {
        id: 'ur-res',
        isPrimary: true,
        role: { id: 'r-res', name: 'RESIDENT_ROL' },
      },
    ],
  };
  const saved: unknown[] = [];
  const qb = {
    update: jest.fn(() => qb),
    set: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    execute: jest.fn(async () => undefined),
  };
  const manager = {
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => qb),
    create: jest.fn((_e: unknown, v: unknown) => v),
    save: jest.fn(async (v: unknown) => {
      saved.push(v);
      return v;
    }),
    findOne: jest.fn(async () => ({ id: 'x' })),
    count: jest.fn(async () => 1),
  };
  const service = Object.create(UsersService.prototype) as UsersService;
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn() },
    userRepo: {
      findOne: jest.fn(async () => ({ ...user })),
      save: jest.fn(async (u: unknown) => u),
      update: jest.fn(),
    },
    roleRepo: {
      findOne: jest.fn(async ({ where }: { where: { name: string } }) => ({
        id: `r-${where.name}`,
        name: where.name,
        status: roleStatus[where.name] ?? true,
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
  return { service, saved };
};

const findRoleOrFail = (service: UsersService, role: string) =>
  (
    service as unknown as { findRoleOrFail: (r: string) => Promise<unknown> }
  ).findRoleOrFail(role);

describe('Roles de la Growth Suite inactivos', () => {
  it.each(['SALES_ROL', 'GROWTH_MANAGER_ROL', 'GROWTH_RESEARCHER_ROL'])(
    'un SUPER_ADMIN no puede dar el cargo %s mientras esté inactivo',
    async (role) => {
      const h = build({ [role]: false });
      await expect(
        h.service.updateUser(
          { userId: 'user-1', role },
          undefined,
          superAdmin as never,
        ),
      ).rejects.toThrow('inactivo');
      expect(h.saved).toEqual([]);
    },
  );

  it('crear un usuario con un rol de la suite inactivo se rechaza (createAdminUser)', async () => {
    const h = build({ SALES_ROL: false });
    await expect(findRoleOrFail(h.service, 'SALES_ROL')).rejects.toThrow(
      'inactivo',
    );
  });

  it('activo, el cargo se asigna con normalidad', async () => {
    const h = build({ SALES_ROL: true });
    await h.service.updateUser(
      { userId: 'user-1', role: 'SALES_ROL' },
      undefined,
      superAdmin as never,
    );
    expect(h.saved).toContainEqual(
      expect.objectContaining({
        role: expect.objectContaining({ id: 'r-SALES_ROL' }),
      }),
    );
  });

  it('los roles existentes no cambian de comportamiento aunque estén inactivos', async () => {
    const h = build({ SECURITY_ROL: false });
    await expect(
      findRoleOrFail(h.service, 'SECURITY_ROL'),
    ).resolves.toMatchObject({
      name: 'SECURITY_ROL',
    });
  });
});
