import { EntityManager } from 'typeorm';

import {
  findResidentRole,
  resolveResidentRoleId,
  RESIDENT_ROLE_ID,
} from './resident-base-role.util';
import { ValidRoles } from '../enums/valid-roles';

/**
 * Producción tiene dos filas RESIDENT_ROL; la vacía no puede ganar nunca.
 */
describe('findResidentRole', () => {
  type Row = { id: string; name: ValidRoles; status: boolean; createdAt: Date };

  const managerOver = (rows: Row[]) => {
    const findOne = jest.fn(async (_entity: any, opts: any) => {
      const where = opts.where;
      let found = rows.filter(
        (r) => r.name === where.name && (!where.id || r.id === where.id),
      );
      if (opts.order) {
        found = [...found].sort(
          (a, b) =>
            Number(b.status) - Number(a.status) ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        );
      }
      return found[0] ?? null;
    });
    return { manager: { findOne } as unknown as EntityManager, findOne };
  };

  const empty: Row = {
    id: 'cad6ca58-empty',
    name: ValidRoles.RESIDENT_ROL,
    status: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const seeded: Row = {
    id: RESIDENT_ROLE_ID,
    name: ValidRoles.RESIDENT_ROL,
    status: true,
    createdAt: new Date('2026-01-01T00:00:17Z'),
  };

  it('elige la fila del seed aunque la vacía sea más antigua', async () => {
    const { manager, findOne } = managerOver([empty, seeded]);
    await expect(findResidentRole(manager)).resolves.toMatchObject({
      id: RESIDENT_ROLE_ID,
    });
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('sin la fila del seed, prefiere la activa', async () => {
    const other = { ...seeded, id: 'other-active' };
    const { manager } = managerOver([{ ...empty, status: false }, other]);
    await expect(resolveResidentRoleId(manager)).resolves.toBe('other-active');
  });

  it('sin ninguna fila, resolveResidentRoleId falla con un mensaje claro', async () => {
    const { manager } = managerOver([]);
    await expect(resolveResidentRoleId(manager)).rejects.toThrow(
      /RESIDENT_ROL/,
    );
  });
});
