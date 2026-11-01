import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ROLES_TO_SEED } from '../../../core/database/seeds/datas/roles.data.seed';
import { PERMISSIONS_TO_SEED } from '../../../core/database/seeds/datas/permissions-data.seed';
import {
  GROWTH_PERMISSION_ENUM_VALUES,
  GROWTH_ROLE_ENUM_VALUES,
} from '../../../core/database/migrations/1781010000000-GrowthRolesAndPermissionsEnum';
import {
  GROWTH_PERMISSION_ROWS,
  GROWTH_ROLE_ROWS,
} from '../../../core/database/migrations/1781010100000-GrowthRolesAndPermissionsData';
import { GROWTH_DEDUPE_PERMISSION_ENUM_VALUES } from '../../../core/database/migrations/1781010600000-GrowthDedupeScoringPermissionsEnum';
import {
  GROWTH_DEDUPE_PERMISSION_ROWS,
  GROWTH_DEDUPE_ROLE_GRANTS,
} from '../../../core/database/migrations/1781010700000-GrowthDedupeScoringPermissionsData';
import { GROWTH_PROSPECT_PERMISSION_ENUM_VALUES } from '../../../core/database/migrations/1781010300000-GrowthProspectPermissionsEnum';
import {
  GROWTH_PROSPECT_PERMISSION_ROWS,
  GROWTH_PROSPECT_ROLE_GRANTS,
} from '../../../core/database/migrations/1781010400000-GrowthProspectPermissionsData';
import {
  GROWTH_COMPLIANCE_PERMISSIONS,
  GROWTH_PERMISSIONS,
  GROWTH_ROLES,
  GROWTH_ROLE_NAMES,
  isInactiveGrowthRole,
} from './growth-access.catalog';

const sorted = (xs: string[]) => [...xs].sort();

describe('Catálogo de acceso de la Growth Suite', () => {
  // Las migraciones de cada entrega quedan congeladas: el catálogo debe ser
  // exactamente la unión de todas ellas.
  const ALL_PERMISSION_ROWS = [
    ...GROWTH_PERMISSION_ROWS,
    ...GROWTH_PROSPECT_PERMISSION_ROWS,
    ...GROWTH_DEDUPE_PERMISSION_ROWS,
  ];

  it('las migraciones de datos son copia fiel del catálogo (permisos)', () => {
    expect(ALL_PERMISSION_ROWS).toEqual(
      GROWTH_PERMISSIONS.map((p) => ({
        id: p.id,
        name: p.name,
        label: p.label,
        description: p.description,
        level: p.level,
        dependsOn: p.dependsOn,
      })),
    );
  });

  it('las migraciones de datos son copia fiel del catálogo (roles y sus permisos)', () => {
    for (const role of GROWTH_ROLES) {
      const phase0 = GROWTH_ROLE_ROWS.find((r) => r.name === role.name)!;
      const { permissions: phase0Perms, ...phase0Role } = phase0;
      const { permissions, ...catalogRole } = role;
      expect(catalogRole).toEqual(phase0Role);
      expect(sorted(permissions)).toEqual(
        sorted([
          ...phase0Perms,
          ...(GROWTH_PROSPECT_ROLE_GRANTS[role.name] ?? []),
          ...(GROWTH_DEDUPE_ROLE_GRANTS[role.name] ?? []),
        ]),
      );
    }
  });

  it('las migraciones de enums agregan exactamente los roles y permisos del catálogo', () => {
    expect(sorted(GROWTH_ROLE_ENUM_VALUES)).toEqual(sorted(GROWTH_ROLE_NAMES));
    expect(
      sorted([
        ...GROWTH_PERMISSION_ENUM_VALUES,
        ...GROWTH_PROSPECT_PERMISSION_ENUM_VALUES,
        ...GROWTH_DEDUPE_PERMISSION_ENUM_VALUES,
      ]),
    ).toEqual(sorted(GROWTH_PERMISSIONS.map((p) => p.name)));
  });

  it('todos los valores existen en los enums de la aplicación', () => {
    for (const p of GROWTH_PERMISSIONS) {
      expect(Object.values(ValidPermissions)).toContain(p.name);
    }
    for (const r of GROWTH_ROLE_NAMES) {
      expect(Object.values(ValidRoles)).toContain(r);
    }
  });

  it('las dependencias apuntan a permisos de la suite', () => {
    const names = GROWTH_PERMISSIONS.map((p) => p.name);
    for (const p of GROWTH_PERMISSIONS) {
      for (const dep of p.dependsOn) expect(names).toContain(dep);
    }
  });

  it('ningún rol tiene APPROVE_GROWTH_PAID_SOURCES (solo SUPER_ADMIN aprueba gasto)', () => {
    for (const role of ROLES_TO_SEED) {
      expect(role.permissions).not.toContain(
        ValidPermissions.APPROVE_GROWTH_PAID_SOURCES,
      );
    }
    expect(GROWTH_COMPLIANCE_PERMISSIONS).not.toContain(
      ValidPermissions.APPROVE_GROWTH_PAID_SOURCES,
    );
  });

  it('levantar exclusiones y retenciones legales no está en ningún rol comercial', () => {
    for (const role of GROWTH_ROLES) {
      expect(role.permissions).not.toContain(
        ValidPermissions.LIFT_GROWTH_SUPPRESSIONS,
      );
      expect(role.permissions).not.toContain(
        ValidPermissions.MANAGE_GROWTH_LEGAL_HOLDS,
      );
      expect(role.permissions).not.toContain(
        ValidPermissions.REVIEW_GROWTH_SOURCES_LEGAL,
      );
    }
  });

  it('ningún rol existente (conjuntos, residentes, compliance) recibe permisos de la suite en el seed', () => {
    const growthPerms = new Set<string>(GROWTH_PERMISSIONS.map((p) => p.name));
    for (const role of ROLES_TO_SEED) {
      if ((GROWTH_ROLE_NAMES as string[]).includes(role.name)) continue;
      expect(role.permissions.filter((p) => growthPerms.has(p))).toEqual([]);
    }
  });

  it('los roles de la suite se siembran inactivos', () => {
    for (const role of ROLES_TO_SEED.filter((r) =>
      (GROWTH_ROLE_NAMES as string[]).includes(r.name),
    )) {
      expect(role.status).toBe(false);
    }
  });

  it('los permisos de la suite se siembran inactivos con la bandera apagada', () => {
    const growth = PERMISSIONS_TO_SEED.filter((p) => p.group === 'GROWTH');
    expect(growth).toHaveLength(GROWTH_PERMISSIONS.length);
    if (process.env.GROWTH_ENABLED !== 'true') {
      for (const p of growth) expect(p.status).toBe(false);
    }
  });

  describe('isInactiveGrowthRole', () => {
    it('bloquea roles de la suite inactivos o sin estado', () => {
      expect(
        isInactiveGrowthRole({ name: ValidRoles.SALES_ROL, status: false }),
      ).toBe(true);
      expect(isInactiveGrowthRole({ name: ValidRoles.SALES_ROL })).toBe(true);
    });
    it('deja pasar un rol de la suite activo', () => {
      expect(
        isInactiveGrowthRole({ name: ValidRoles.SALES_ROL, status: true }),
      ).toBe(false);
    });
    it('no cambia el comportamiento de los roles existentes, aunque estén inactivos', () => {
      expect(
        isInactiveGrowthRole({ name: ValidRoles.SECURITY_ROL, status: false }),
      ).toBe(false);
      expect(
        isInactiveGrowthRole({
          name: ValidRoles.COMPILANCE_OFFICER_ROL,
          status: false,
        }),
      ).toBe(false);
    });
  });
});
