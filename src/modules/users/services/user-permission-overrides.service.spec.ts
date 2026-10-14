import { UserPermissionOverridesService } from './user-permission-overrides.service';
import { PermissionOverrideEffect } from '../enums/permission-override-effect.enum';
import { UserStatus } from '../enums/user.enums';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../auth/interfaces/jwt-payload.interface';

describe('UserPermissionOverridesService', () => {
  const viewPackages = { id: 'p-view', name: 'VIEW_PACKAGES' };
  const editResidents = { id: 'p-edit', name: 'EDIT_RESIDENTS' };

  const accountant = {
    id: 'user-1',
    email: 'conta@example.com',
    status: UserStatus.ACTIVE,
    complexId: 'complex-1',
    userRoles: [
      { role: { name: ValidRoles.RESIDENT_ROL, permissions: [viewPackages] } },
      {
        role: {
          name: ValidRoles.ACCOUNTANT_ROL,
          permissions: [viewPackages, editResidents],
        },
      },
    ],
  };

  const actor = {
    sub: 'admin-1',
    email: 'admin@example.com',
    roles: [ValidRoles.RESIDENT_ROL, ValidRoles.SUPER_ADMIN_ROL],
  } as unknown as JwtAccessPayload;

  const build = (user: any = accountant, overrides: any[] = []) => {
    const overrideRepo = {
      find: jest.fn(async () => overrides),
      findOne: jest.fn(async () => overrides[0] ?? null),
      create: jest.fn((row: any) => row),
      save: jest.fn(async (row: any) => ({ id: 'ov-1', ...row })),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const userRepo = {
      findOne: jest.fn(async () => user),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const permissionRepo = {
      findOne: jest.fn(async () => editResidents),
    };
    const tokenService = {
      clearUserTokenVersionCache: jest.fn(async () => undefined),
    };
    const auditService = { log: jest.fn(async () => undefined) };
    const service = new UserPermissionOverridesService(
      overrideRepo as never,
      userRepo as never,
      permissionRepo as never,
      tokenService as never,
      auditService as never,
    );
    return { service, overrideRepo, userRepo, tokenService, auditService };
  };

  it('el resumen junta los roles de cada permiso y aplica las excepciones', async () => {
    const { service } = build(accountant, [
      {
        effect: PermissionOverrideEffect.DENY,
        permission: editResidents,
      },
    ]);

    const summary = await service.summary('user-1');

    expect(summary.rolePermissions).toEqual([
      { permission: editResidents, roles: [ValidRoles.ACCOUNTANT_ROL] },
      {
        permission: viewPackages,
        roles: [ValidRoles.RESIDENT_ROL, ValidRoles.ACCOUNTANT_ROL],
      },
    ]);
    expect(summary.effectivePermissions).toEqual(['VIEW_PACKAGES']);
    expect(summary.isSuperAdmin).toBe(false);
  });

  it('quitar un permiso sube tokenVersion para que la sesión lo recoja', async () => {
    const { service, overrideRepo, userRepo, tokenService, auditService } =
      build();

    await service.set(
      {
        userId: 'user-1',
        permissionId: 'p-edit',
        effect: PermissionOverrideEffect.DENY,
        reason: '  no anula cargos  ',
      },
      actor,
    );

    expect(overrideRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        permissionId: 'p-edit',
        effect: PermissionOverrideEffect.DENY,
        reason: 'no anula cargos',
        createdById: 'admin-1',
      }),
    );
    expect(userRepo.update).toHaveBeenCalledWith('user-1', {
      tokenVersion: expect.any(Function),
    });
    expect(tokenService.clearUserTokenVersionCache).toHaveBeenCalledWith(
      'user-1',
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ performedByRole: ValidRoles.SUPER_ADMIN_ROL }),
    );
  });

  it('no deja crear excepciones para un SUPER_ADMIN', async () => {
    const { service, overrideRepo } = build({
      ...accountant,
      userRoles: [
        { role: { name: ValidRoles.SUPER_ADMIN_ROL, permissions: [] } },
      ],
    });

    await expect(
      service.set(
        {
          userId: 'user-1',
          permissionId: 'p-edit',
          effect: PermissionOverrideEffect.DENY,
        },
        actor,
      ),
    ).rejects.toMatchObject({ errorCode: 'PERMISSION_OVERRIDE_SUPER_ADMIN' });
    expect(overrideRepo.save).not.toHaveBeenCalled();
  });

  it('quitar una excepción que no existe responde NOT_FOUND', async () => {
    const { service } = build(accountant, []);

    await expect(
      service.remove('user-1', 'p-edit', actor),
    ).rejects.toMatchObject({ errorCode: 'PERMISSION_OVERRIDE_NOT_FOUND' });
  });
});
