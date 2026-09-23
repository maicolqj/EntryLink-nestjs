import { EntityManager } from 'typeorm';

import {
  ROLES_WITH_RESIDENT_BASE,
  ensureResidentRole,
  roleNeedsResidentBase,
} from './resident-base-role.util';
import { ValidRoles } from '../enums/valid-roles';

/**
 * RESIDENT_ROL como rol base: se suma al cargo, no lo reemplaza, y nunca
 * desplaza al rol principal de quien ya tenía uno.
 */
describe('resident-base-role.util', () => {
  const RESIDENT_ROLE_ID = 'role-resident';

  /** Filas de user_has_roles que el manager falso ve y escribe. */
  let rows: { userId: string; roleId: string; isPrimary: boolean }[];
  let saved: any[];

  const manager = {
    findOne: jest.fn(async (entity: any, opts: any) => {
      // resolveResidentRoleId busca el Role; el resto busca el UserRole.
      if (opts?.where?.name === ValidRoles.RESIDENT_ROL) {
        return { id: RESIDENT_ROLE_ID };
      }
      const userId = opts?.where?.user?.id;
      const roleId = opts?.where?.role?.id;
      return (
        rows.find((r) => r.userId === userId && r.roleId === roleId) ?? null
      );
    }),
    count: jest.fn(
      async (_entity: any, opts: any) =>
        rows.filter((r) => r.userId === opts?.where?.user?.id).length,
    ),
    create: jest.fn((_entity: any, data: any) => data),
    save: jest.fn(async (data: any) => {
      saved.push(data);
      rows.push({
        userId: data.user.id,
        roleId: data.role.id,
        isPrimary: data.isPrimary,
      });
      return data;
    }),
  } as unknown as EntityManager;

  beforeEach(() => {
    rows = [];
    saved = [];
    jest.clearAllMocks();
  });

  // ── Qué roles arrastran el rol base ───────────────────────────────────────

  it.each(ROLES_WITH_RESIDENT_BASE)('%s lleva RESIDENT_ROL de base', (role) => {
    expect(roleNeedsResidentBase(role)).toBe(true);
  });

  it.each([
    // La cuenta del complejo no es un usuario: no tiene fila en `users`.
    ValidRoles.COMPLEX_ROL,
    // Aseo y mantenimiento todavía no inicia sesión.
    ValidRoles.MAINTENANCE_ROL,
  ])('%s NO lleva rol base', (role) => {
    expect(roleNeedsResidentBase(role)).toBe(false);
  });

  // ── Asignación ────────────────────────────────────────────────────────────

  it('a una cuenta sin roles le deja RESIDENT_ROL como principal', async () => {
    const added = await ensureResidentRole(manager, 'user-1');

    expect(added).toBe(true);
    expect(saved[0].isPrimary).toBe(true);
  });

  it('a una cuenta con cargo lo suma SIN desplazar el rol principal', async () => {
    rows.push({
      userId: 'user-1',
      roleId: 'role-super-admin',
      isPrimary: true,
    });

    const added = await ensureResidentRole(manager, 'user-1');

    expect(added).toBe(true);
    expect(saved[0].isPrimary).toBe(false);
    // El cargo sigue siendo el principal: es el que decide a dónde entra al
    // iniciar sesión con correo y contraseña.
    expect(rows.find((r) => r.roleId === 'role-super-admin')?.isPrimary).toBe(
      true,
    );
  });

  it('es idempotente: correrlo dos veces no duplica el rol', async () => {
    await ensureResidentRole(manager, 'user-1');
    const second = await ensureResidentRole(manager, 'user-1');

    expect(second).toBe(false);
    expect(rows.filter((r) => r.roleId === RESIDENT_ROLE_ID)).toHaveLength(1);
  });

  it('acepta el id del rol ya resuelto y se ahorra la consulta', async () => {
    await ensureResidentRole(manager, 'user-1', RESIDENT_ROLE_ID);

    const roleLookups = (manager.findOne as jest.Mock).mock.calls.filter(
      ([, opts]) => opts?.where?.name === ValidRoles.RESIDENT_ROL,
    );
    expect(roleLookups).toHaveLength(0);
  });

  it('falla claro si el seed de roles no corrió', async () => {
    (manager.findOne as jest.Mock).mockResolvedValueOnce(null);

    await expect(ensureResidentRole(manager, 'user-1')).rejects.toThrow(
      /RESIDENT_ROL/,
    );
  });
});
