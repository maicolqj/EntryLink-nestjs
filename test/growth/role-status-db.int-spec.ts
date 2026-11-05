/**
 * Estado activo de los ROLES, de punta a punta contra Postgres real (misma
 * base desechable que la Growth Suite; ver docs/growth/TESTING.md). Crea su
 * propio rol, permiso y usuario (prefijo eeeeeeee-) y los borra al terminar.
 *
 * Recorre: rol activo; inactivarlo con RolesService (relación corregida,
 * usuarios activos, versión del token); el estado que lee el guard; un token
 * emitido antes; reactivar; y los roles base que no se inactivan.
 */
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => class {},
  PassportStrategy: () => class {},
}));

import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Permission } from '../../src/modules/permissions/entities/permission.entity';
import { Role } from '../../src/modules/roles/entities/role.entity';
import { ValidPermissions as P } from '../../src/modules/permissions/enums/valid-permissions';
import { PermissionStatusService } from '../../src/modules/permissions/services/permission-status.service';
import { resetInactivePermissions } from '../../src/modules/shared/permission-status/permission-status.registry';
import { RolesService } from '../../src/modules/roles/roles.service';
import { ValidRoles } from '../../src/modules/roles/enums/valid-roles';
import { UniversalRolePermissionGuard } from '../../src/modules/shared/guards/universal-role-permission.guard';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const USER = 'eeeeeeee-0000-4000-8000-000000000001';
const ROLE = 'eeeeeeee-0000-4000-8000-0000000000a1';
const PERM = 'eeeeeeee-0000-4000-8000-0000000000b1';
const ROLE_NAME = ValidRoles.MAINTENANCE_ROL;
const PERM_NAME = P.VIEW_PRODUCTS;

class Ops {
  @SetMetadata('roles', [ROLE_NAME])
  porRol() {}

  @SetMetadata('permissions', [PERM_NAME])
  porPermiso() {}
}

describeDb('Roles: el estado activo manda (base real)', () => {
  let ds: DataSource;
  let status: PermissionStatusService;
  let roles: RolesService;
  let guard: UniversalRolePermissionGuard;
  const cacheDeleted: string[] = [];

  const versionOf = async (): Promise<number> =>
    (
      await ds.query(`SELECT "tokenVersion" FROM public.users WHERE id = $1`, [
        USER,
      ])
    )[0].tokenVersion;

  const allowed = (op: keyof Ops) => {
    // Un token emitido con el rol activo: trae su nombre y su permiso.
    const token = { roles: [ROLE_NAME], permissions: [PERM_NAME] };
    const ctx = new ExecutionContextHost(
      [
        {},
        {},
        { req: { user: { ...token, sub: USER, email: 'r@alternaqj.com' } } },
        {},
      ],
      Ops,
      Ops.prototype[op],
    );
    ctx.setType('graphql');
    return guard.canActivate(ctx);
  };

  const cleanup = async () => {
    await ds.query(`DELETE FROM public.user_has_roles WHERE user_id = $1`, [
      USER,
    ]);
    await ds.query(`DELETE FROM public.role_permissions WHERE role_id = $1`, [
      ROLE,
    ]);
    await ds.query(`DELETE FROM public.users WHERE id = $1`, [USER]);
    await ds.query(`DELETE FROM public.roles WHERE id = $1`, [ROLE]);
    await ds.query(`DELETE FROM public.permissions WHERE id = $1`, [PERM]);
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: [join(__dirname, '../../src/**/*.entity.ts')],
      synchronize: false,
    });
    await ds.initialize();
    const [{ db }] = await ds.query('SELECT current_database() AS db');
    if (!/test/i.test(db)) throw new Error(`Base "${db}" no parece de prueba`);
    await cleanup();
    await ds.query(
      `INSERT INTO public.permissions (id, name, label, description, "group", level, "isSystem", status)
       VALUES ($1, $2, 'IT rol', 'Prueba de estado de rol', 'IT', 'LOW', false, true)`,
      [PERM, PERM_NAME],
    );
    await ds.query(
      `INSERT INTO public.roles (id, name, "frontName", description, status, icon)
       VALUES ($1, $2, 'Rol IT', 'Prueba de estado de rol', true, 'shield')`,
      [ROLE, ROLE_NAME],
    );
    await ds.query(
      `INSERT INTO public.role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [ROLE, PERM],
    );
    await ds.query(
      `INSERT INTO public.users (id, name, last_name, number_phone, email, password, status)
       VALUES ($1, 'Roles', 'IT', '3009870002', 'roles-it@alternaqj.com', 'x', 'active')`,
      [USER],
    );
    await ds.query(
      `INSERT INTO public.user_has_roles (user_id, role_id) VALUES ($1, $2)`,
      [USER, ROLE],
    );

    resetInactivePermissions();
    status = new PermissionStatusService(ds, {
      delete: ({ key }: { key: { key: string } }) => {
        cacheDeleted.push(key.key);
        return Promise.resolve();
      },
    } as never);
    roles = new RolesService(
      ds.getRepository(Role),
      ds.getRepository(Permission),
      ds,
      status,
    );
    guard = new UniversalRolePermissionGuard(new Reflector(), status);
  });

  afterAll(async () => {
    await cleanup();
    await ds?.destroy();
  });

  it('rol activo: la operación que exige el rol y la que exige su permiso pasan', async () => {
    status.invalidate();
    await expect(allowed('porRol')).resolves.toBe(true);
    await expect(allowed('porPermiso')).resolves.toBe(true);
  });

  it('con un usuario ACTIVO asignado, no se puede inactivar', async () => {
    await expect(roles.remove(ROLE)).rejects.toMatchObject({
      errorCode: 'ROL_HAS_ACTIVE_USERS',
    });
  });

  it('con el usuario suspendido sí; sube su tokenVersion y el guard deja de aceptar el rol del token viejo', async () => {
    await ds.query(
      `UPDATE public.users SET status = 'suspended' WHERE id = $1`,
      [USER],
    );
    const before = await versionOf();
    cacheDeleted.length = 0;

    await roles.remove(ROLE);

    expect(await versionOf()).toBe(before + 1);
    expect(cacheDeleted).toContain(USER);
    const [{ s }] = await ds.query(
      `SELECT status AS s FROM public.roles WHERE id = $1`,
      [ROLE],
    );
    expect(s).toBe(false);
    // El servicio pidió releer: el guard ya ve el rol inactivo.
    await expect(allowed('porRol')).resolves.toBe(false);
  });

  it('reactivarlo sube otra vez la versión y el rol vuelve a contar', async () => {
    const before = await versionOf();
    await roles.restore(ROLE);
    expect(await versionOf()).toBe(before + 1);
    await expect(allowed('porRol')).resolves.toBe(true);
  });

  it('el estado de los roles se lee de la base aunque cambie por SQL (a más tardar 30 s; aquí se fuerza)', async () => {
    await ds.query(`UPDATE public.roles SET status = false WHERE id = $1`, [
      ROLE,
    ]);
    status.invalidate();
    await expect(allowed('porRol')).resolves.toBe(false);
    await ds.query(`UPDATE public.roles SET status = true WHERE id = $1`, [
      ROLE,
    ]);
    status.invalidate();
    await expect(allowed('porRol')).resolves.toBe(true);
  });
});
