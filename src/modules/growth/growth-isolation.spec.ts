// @nestjs/passport es ESM y jest (CJS, Node 22) no lo carga. Aquí solo
// importan las referencias a los guards, no la autenticación real.
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => class {},
  PassportStrategy: () => class {},
}));

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { GrowthModule } from './growth.module';

/**
 * Aislamiento de la Growth Suite, verificado sobre el código (no solo por
 * convención). Es la lista autoritativa; la regla de ESLint es el aviso
 * rápido en el editor.
 */

const SRC = resolve(__dirname, '../..');
const GROWTH = resolve(__dirname);
const norm = (p: string) => relative(SRC, p).split(sep).join('/');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const tsFiles = (dir: string) =>
  walk(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

function relativeImports(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const specs = [...code.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(
    (m) => m[1],
  );
  return specs
    .filter((s) => s.startsWith('.'))
    .map((s) => norm(resolve(dirname(file), s)));
}

/** Lo único de fuera que la suite puede importar. */
const OUTBOUND_ALLOWED = [
  /^modules\/growth\//,
  /^modules\/shared\//,
  /^modules\/permissions\/enums\//,
  /^modules\/roles\/enums\//,
];

describe('Aislamiento de la Growth Suite', () => {
  const growthSources = tsFiles(GROWTH).filter((f) => !f.endsWith('.spec.ts'));

  it('no importa módulos operativos (allow-list de rutas resueltas)', () => {
    const violations = growthSources.flatMap((file) =>
      relativeImports(file)
        .filter((target) => !OUTBOUND_ALLOWED.some((re) => re.test(target)))
        .map((target) => `${norm(file)} → ${target}`),
    );
    expect(violations).toEqual([]);
  });

  it('fuera de la suite solo se importa su catálogo de acceso (y app.module, el cargador)', () => {
    const outside = tsFiles(SRC).filter(
      (f) => !f.startsWith(GROWTH + sep) && !f.endsWith('.spec.ts'),
    );
    const violations = outside.flatMap((file) =>
      relativeImports(file)
        .filter((t) => t.startsWith('modules/growth/'))
        .filter(
          (t) =>
            t !== 'modules/growth/shared/growth-access.catalog' &&
            !(
              norm(file) === 'app.module.ts' &&
              t === 'modules/growth/growth.loader'
            ),
        )
        .map((t) => `${norm(file)} → ${t}`),
    );
    expect(violations).toEqual([]);
  });

  it('solo IdentityDirectoryService consulta el esquema public (y solo identidad)', () => {
    const offenders = growthSources
      // SQL que lee o escribe en public (los comentarios no cuentan).
      .filter((f) =>
        /\b(FROM|JOIN|INTO|UPDATE)\s+public\./i.test(readFileSync(f, 'utf8')),
      )
      .map(norm);
    expect(offenders).toEqual([
      'modules/growth/shared/identity-directory.service.ts',
    ]);

    const sql = readFileSync(
      join(GROWTH, 'shared/identity-directory.service.ts'),
      'utf8',
    );
    const tables = [...sql.matchAll(/public\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual([
      'roles',
      'user_complex_assignments',
      'user_has_roles',
      'users',
    ]);
  });

  describe('entidades', () => {
    // Importar el módulo carga sus entidades en el registro de TypeORM.
    expect(GrowthModule).toBeDefined();
    const storage = getMetadataArgsStorage();
    const growthEntities = storage.tables.filter(
      (t) => (t as { schema?: string }).schema === 'growth',
    );
    const growthTargets = new Set(growthEntities.map((t) => t.target));

    it('todas las entidades de la suite viven en el esquema growth', () => {
      expect(growthEntities.map((t) => t.name).sort()).toEqual([
        'activity_events',
        'data_sources',
        'data_subject_requests',
        'employments',
        'evidences',
        'legal_holds',
        'organization_channels',
        'organizations',
        'people',
        'person_channels',
        'properties',
        'property_managements',
        'prospect_assignments',
        'settings',
        'suppression_hashes',
        'suppressions',
        'team_members',
      ]);
    });

    it('no hay relaciones TypeORM entre la suite y entidades operativas', () => {
      const crossing = storage.relations.filter((r) => {
        const from = growthTargets.has(r.target as never);
        const type =
          typeof r.type === 'function' ? (r.type as () => unknown)() : r.type;
        const to = growthTargets.has(type as never);
        return from !== to;
      });
      expect(crossing).toEqual([]);
    });
  });
});
