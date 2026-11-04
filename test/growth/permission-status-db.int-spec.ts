/**
 * Estado activo de los permisos, de punta a punta contra Postgres real
 * (ver docs/growth/TESTING.md). No es de la Growth Suite: usa la misma base
 * desechable. Crea sus propios permisos, rol y usuario (prefijo ffffffff-) y
 * los borra al terminar.
 *
 * Recorre los casos de la corrección: permiso activo, inactivo y nuevo
 * inactivo en un rol activo; desactivar y volver a activar con
 * PermissionsService (versión del token, caché y estado); tokens emitidos
 * antes del cambio; renovación; SUPER_ADMIN (sin paso con permisos
 * inactivos); y acceso sin autorización.
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
import { ValidPermissions as P } from '../../src/modules/permissions/enums/valid-permissions';
import { PermissionDependencyService } from '../../src/modules/permissions/services/permission-dependecy.service';
import { PermissionStatusService } from '../../src/modules/permissions/services/permission-status.service';
import { resetInactivePermissions } from '../../src/modules/shared/permission-status/permission-status.registry';
import { PermissionsService } from '../../src/modules/permissions/services/permissions.service';
import { ValidRoles } from '../../src/modules/roles/enums/valid-roles';
import { UniversalRolePermissionGuard } from '../../src/modules/shared/guards/universal-role-permission.guard';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const USER = 'ffffffff-0000-4000-8000-000000000001';
const ROLE = 'ffffffff-0000-4000-8000-0000000000a1';
const PA = 'ffffffff-0000-4000-8000-0000000000b1'; // activo
const PB = 'ffffffff-0000-4000-8000-0000000000b2'; // se desactiva y reactiva
const PC = 'ffffffff-0000-4000-8000-0000000000b3'; // nuevo, nace inactivo
// Valores reales del enum que la base de prueba no usa (no se siembran).
const A = P.VIEW_PACKAGES;
const B = P.VIEW_VISITS;
const C = P.VIEW_VISITORS;
const ROLE_NAME = ValidRoles.ACCOUNTANT_ROL;

class Ops {
  @SetMetadata('permissions', [A])
  usaA() {}

  @SetMetadata('permissions', [B])
  usaB() {}

  @SetMetadata('permissions', [C])
  usaC() {}
}

describeDb('Permisos: el estado activo manda (base real)', () => {
  let ds: DataSource;
  let status: PermissionStatusService;
  let permissions: PermissionsService;
  let guard: UniversalRolePermissionGuard;
  const cacheDeleted: string[] = [];

  /** El usuario como lo carga el login: roles con sus permisos (y su estado). */
  const loadUser = async () => {
    const [u] = await ds.query(
      `SELECT id, "tokenVersion" FROM public.users WHERE id = $1`,
      [USER],
    );
    const perms: Array<{ name: P; status: boolean }> = await ds.query(
      `SELECT p.name::text AS name, p.status FROM public.role_permissions rp
         JOIN public.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1`,
      [ROLE],
    );
    return { id: u.id, tokenVersion: u.tokenVersion, perms };
  };
  /** Lo que haría extractPermissions con ese usuario (misma regla). */
  const tokenPermissions = async () =>
    (await loadUser()).perms
      .filter((p) => p.status !== false)
      .map((p) => p.name)
      .sort();
  const allowed = (
    op: keyof Ops,
    user: { roles: string[]; permissions: string[] },
  ) => {
    const ctx = new ExecutionContextHost(
      [
        {},
        {},
        { req: { user: { ...user, sub: USER, email: 'p@alternaqj.com' } } },
        {},
      ],
      Ops,
      Ops.prototype[op],
    );
    ctx.setType('graphql');
    return guard.canActivate(ctx);
  };
  const versionOf = async () => (await loadUser()).tokenVersion as number;

  const cleanup = async () => {
    await ds.query(`DELETE FROM public.user_has_roles WHERE user_id = $1`, [
      USER,
    ]);
    await ds.query(`DELETE FROM public.role_permissions WHERE role_id = $1`, [
      ROLE,
    ]);
    await ds.query(`DELETE FROM public.users WHERE id = $1`, [USER]);
    await ds.query(`DELETE FROM public.roles WHERE id = $1`, [ROLE]);
    await ds.query(
      `DELETE FROM public.permissions WHERE id = ANY($1::uuid[])`,
      [[PA, PB, PC]],
    );
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      // Permission arrastra roles, usuarios y el resto del modelo: todas las entidades.
      entities: [join(__dirname, '../../src/**/*.entity.ts')],
      synchronize: false,
    });
    await ds.initialize();
    const [{ db }] = await ds.query('SELECT current_database() AS db');
    if (!/test/i.test(db)) throw new Error(`Base "${db}" no parece de prueba`);
    await cleanup();
    for (const [id, name, active] of [
      [PA, A, true],
      [PB, B, true],
      [PC, C, false],
    ] as const) {
      await ds.query(
        `INSERT INTO public.permissions (id, name, label, description, "group", level, "isSystem", status)
         VALUES ($1, $2, $3, 'Prueba de estado', 'IT', 'LOW', false, $4)`,
        [id, name, `IT ${name}`, active],
      );
    }
    await ds.query(
      `INSERT INTO public.roles (id, name, "frontName", description, status, icon)
       VALUES ($1, $2, 'Rol IT', 'Prueba de estado', true, 'shield')`,
      [ROLE, ROLE_NAME],
    );
    await ds.query(
      `INSERT INTO public.role_permissions (role_id, permission_id) VALUES ($1, $2), ($1, $3), ($1, $4)`,
      [ROLE, PA, PB, PC],
    );
    await ds.query(
      `INSERT INTO public.users (id, name, last_name, number_phone, email, password)
       VALUES ($1, 'Permisos', 'IT', '3009870001', 'permisos-it@alternaqj.com', 'x')`,
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
    permissions = new PermissionsService(
      ds.getRepository(Permission),
      ds,
      new PermissionDependencyService(ds.getRepository(Permission)),
      status,
    );
    guard = new UniversalRolePermissionGuard(new Reflector(), status);
  });

  afterAll(async () => {
    await cleanup();
    await ds?.destroy();
  });

  it('1 y 3. rol activo: el permiso activo va al token; el nuevo inactivo no, y la operación que lo exige no pasa', async () => {
    expect(await tokenPermissions()).toEqual([A, B].sort());
    const token = { roles: [ROLE_NAME], permissions: await tokenPermissions() };
    await expect(allowed('usaA', token)).resolves.toBe(true);
    // Aunque alguien fabricara un token con C, está inactivo en la base.
    await expect(
      allowed('usaC', { ...token, permissions: [...token.permissions, C] }),
    ).resolves.toBe(false);
  });

  it('2, 5 y 6. desactivar: deja de ir en el token, sube la versión de quien lo tenía y el token viejo deja de servir', async () => {
    const oldToken = {
      roles: [ROLE_NAME],
      permissions: await tokenPermissions(),
    };
    const before = await versionOf();
    await expect(allowed('usaB', oldToken)).resolves.toBe(true);

    await permissions.remove(PB);

    expect(await tokenPermissions()).toEqual([A]);
    expect(await versionOf()).toBe(before + 1); // la estrategia JWT rechaza la versión vieja
    expect(cacheDeleted).toContain(USER); // y no espera los 5 min de caché
    // Aunque el token viejo siguiera circulando, el guard ya no lo acepta.
    await expect(allowed('usaB', oldToken)).resolves.toBe(false);
    await expect(allowed('usaA', oldToken)).resolves.toBe(true);
  });

  it('4 y 7. activar otra vez: sube la versión y la renovación trae el permiso', async () => {
    const before = await versionOf();
    await permissions.restore(PB);
    expect(await versionOf()).toBe(before + 1);
    const renewed = {
      roles: [ROLE_NAME],
      permissions: await tokenPermissions(),
    };
    expect(renewed.permissions).toEqual([A, B].sort());
    await expect(allowed('usaB', renewed)).resolves.toBe(true);
  });

  it('un cambio por SQL (sin el servicio) se respeta al vencer la caché de 30 s', async () => {
    await ds.query(
      `UPDATE public.permissions SET status = false WHERE id = $1`,
      [PB],
    );
    status.invalidate(); // equivale a que pasen los 30 s
    const token = { roles: [ROLE_NAME], permissions: [A, B] };
    await expect(allowed('usaB', token)).resolves.toBe(false);
    await ds.query(
      `UPDATE public.permissions SET status = true WHERE id = $1`,
      [PB],
    );
    status.invalidate();
    await expect(allowed('usaB', token)).resolves.toBe(true);
  });

  it('8. SUPER_ADMIN: pasa con el permiso activo; con el inactivo, no (apagado para todos)', async () => {
    const superAdmin = { roles: [ValidRoles.SUPER_ADMIN_ROL], permissions: [] };
    await expect(allowed('usaA', superAdmin)).resolves.toBe(true);
    await expect(allowed('usaC', superAdmin)).resolves.toBe(false);
  });

  it('10. sin el permiso o con otro rol, no pasa', async () => {
    await expect(
      allowed('usaA', { roles: [ROLE_NAME], permissions: [] }),
    ).resolves.toBe(false);
    await expect(
      allowed('usaA', { roles: [ValidRoles.RESIDENT_ROL], permissions: [B] }),
    ).resolves.toBe(false);
  });
});
