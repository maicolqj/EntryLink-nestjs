import { NON_DEACTIVATABLE_ROLES, RolesService } from './roles.service';
import { ValidRoles } from './enums/valid-roles';
import { UserStatus } from '../users/enums/user.enums';

/**
 * Inactivar y reactivar un rol: los roles base no se tocan, solo cuentan los
 * usuarios activos y quien tenga el rol recibe el token siguiente sin él (o
 * con él al reactivarlo).
 */
const build = (role: Record<string, unknown>) => {
  const findOne = jest.fn(
    async (_e: unknown, opts: { relations?: string[] }) => {
      return { ...role, relations: opts?.relations };
    },
  );
  const manager = {
    findOne,
    update: jest.fn(async () => ({ affected: 1 })),
    save: jest.fn(async (_e: unknown, r: unknown) => r),
  };
  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager,
  };
  const permissionStatus = {
    bumpRoleHolders: jest.fn(async () => ['user-1', 'user-2']),
    afterCommit: jest.fn(async () => undefined),
  };
  const service = Object.create(RolesService.prototype) as RolesService;
  Object.assign(service, {
    logger: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    dataSource: { createQueryRunner: () => queryRunner },
    permissionStatus,
    getAncestorChain: jest.fn(async () => []),
    updateParentRolesWithInheritedPermissions: jest.fn(),
  });
  return { service, manager, queryRunner, permissionStatus };
};

const baseRole = (over: Record<string, unknown> = {}) => ({
  id: 'role-1',
  name: ValidRoles.SALES_ROL,
  status: true,
  isSystem: false,
  children: [],
  permissions: [],
  userRoles: [],
  metadata: {},
  ...over,
});

describe('RolesService: inactivar y reactivar roles', () => {
  it('carga la relación correcta (`userRoles`; antes `UserRoles`, que TypeORM rechazaba)', async () => {
    const h = build(baseRole());
    await h.service.remove('role-1');
    expect(h.manager.findOne.mock.calls[0][1]).toMatchObject({
      relations: expect.arrayContaining(['userRoles', 'userRoles.user']),
    });
  });

  it.each(NON_DEACTIVATABLE_ROLES)('%s no se puede inactivar', async (name) => {
    const h = build(baseRole({ name }));
    await expect(h.service.remove('role-1')).rejects.toMatchObject({
      errorCode: 'SYSTEM_ROL_CANNOT_BE_MODIFIED',
    });
    expect(h.manager.update).not.toHaveBeenCalled();
  });

  it('con usuarios activos no se inactiva', async () => {
    const h = build(
      baseRole({
        userRoles: [{ user: { status: UserStatus.ACTIVE, email: 'a@x.co' } }],
      }),
    );
    await expect(h.service.remove('role-1')).rejects.toMatchObject({
      errorCode: 'ROL_HAS_ACTIVE_USERS',
    });
  });

  it('un usuario suspendido no cuenta como activo', async () => {
    const h = build(
      baseRole({
        userRoles: [
          { user: { status: UserStatus.SUSPENDED, email: 'a@x.co' } },
        ],
      }),
    );
    await expect(h.service.remove('role-1')).resolves.toMatchObject({
      id: 'role-1',
    });
  });

  it('inactivar sube tokenVersion a quien lo tiene, dentro de la transacción, y limpia la caché después', async () => {
    const h = build(baseRole());
    await h.service.remove('role-1');
    expect(h.permissionStatus.bumpRoleHolders).toHaveBeenCalledWith(
      'role-1',
      h.manager,
    );
    expect(h.permissionStatus.afterCommit).toHaveBeenCalledWith([
      'user-1',
      'user-2',
    ]);
    const commitOrder =
      h.queryRunner.commitTransaction.mock.invocationCallOrder[0];
    expect(
      h.permissionStatus.bumpRoleHolders.mock.invocationCallOrder[0],
    ).toBeLessThan(commitOrder);
    expect(
      h.permissionStatus.afterCommit.mock.invocationCallOrder[0],
    ).toBeGreaterThan(commitOrder);
  });

  it('reactivar también sube tokenVersion: el rol vuelve en el token siguiente', async () => {
    const h = build(baseRole({ status: false, parent: null }));
    await h.service.restore('role-1');
    expect(h.permissionStatus.bumpRoleHolders).toHaveBeenCalledWith(
      'role-1',
      h.manager,
    );
    expect(h.permissionStatus.afterCommit).toHaveBeenCalled();
  });
});
