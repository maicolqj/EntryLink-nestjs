import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plantillas de importación personales y del equipo (2/2).
 *
 * - Permiso MANAGE_GROWTH_IMPORT_TEMPLATES, INACTIVO y SIN asignar a ningún
 *   rol: el token toma los permisos del rol sin mirar su estado, así que
 *   asignarlo a GROWTH_MANAGER_ROL (ya activo en producción) lo activaría al
 *   desplegar. Se asigna con el SQL de docs/growth/ACTIVATION.md.
 * - `scope` PERSONAL o TEAM, dueño, archivado lógico y quién editó.
 * - Las plantillas que ya existen eran de todo el equipo: pasan a TEAM y su
 *   autor queda como dueño (no cambia lo que se ve hoy).
 * - Nombres únicos entre las vigentes: por dueño en PERSONAL y por destino en
 *   TEAM. Guardar con un nombre tomado es un error, nunca una sobrescritura.
 *
 * Copia fija del catálogo; su spec falla si se separan.
 */
export const GROWTH_TEMPLATE_PERMISSION_ROWS = [
  {
    id: '5b0f2e8c-3c47-4b1e-9a7d-6e2f41c9d0a3',
    name: 'MANAGE_GROWTH_IMPORT_TEMPLATES',
    label: 'Administrar Plantillas de Importación',
    description:
      'Crear, compartir, editar y archivar las plantillas de importación del equipo',
    level: 'MEDIUM',
    dependsOn: ['IMPORT_GROWTH_DATA'],
  },
];

const T = 'growth.import_mapping_templates';

export class GrowthImportTemplatesScope1781011400000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    for (const p of GROWTH_TEMPLATE_PERMISSION_ROWS) {
      await q.query(
        `INSERT INTO "permissions" ("id", "name", "label", "description", "group", "level", "isSystem", "status")
         VALUES ($1, $2, $3, $4, 'GROWTH', $5, false, false)
         ON CONFLICT DO NOTHING`,
        [p.id, p.name, p.label, p.description, p.level],
      );
      for (const dep of p.dependsOn) {
        await q.query(
          `INSERT INTO "permission_dependencies" ("permission_id", "depends_on_id")
           SELECT p."id", d."id" FROM "permissions" p
             JOIN "permissions" d ON d."name" = $2
            WHERE p."name" = $1
           ON CONFLICT DO NOTHING`,
          [p.name, dep],
        );
      }
    }

    await q.query(`
      ALTER TABLE ${T}
        ADD COLUMN IF NOT EXISTS scope varchar(10) NOT NULL DEFAULT 'PERSONAL',
        ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        ADD COLUMN IF NOT EXISTS archived_at timestamptz,
        ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT`);
    // Lo que existía era de todo el equipo; el autor queda como dueño.
    await q.query(
      `UPDATE ${T} SET scope = 'TEAM', owner_user_id = created_by_user_id WHERE owner_user_id IS NULL`,
    );
    await q.query(`ALTER TABLE ${T} ALTER COLUMN owner_user_id SET NOT NULL`);
    await q.query(`
      ALTER TABLE ${T}
        ADD CONSTRAINT ck_growth_import_tpl_scope CHECK (scope IN ('PERSONAL', 'TEAM')),
        ADD CONSTRAINT ck_growth_import_tpl_archived CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL))`);
    await q.query(`DROP INDEX IF EXISTS growth.uq_growth_import_tpl_name`);
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_import_tpl_team ON ${T} (target, lower(name)) WHERE scope = 'TEAM' AND archived_at IS NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_import_tpl_personal ON ${T} (owner_user_id, target, lower(name)) WHERE scope = 'PERSONAL' AND archived_at IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS growth.uq_growth_import_tpl_personal`);
    await q.query(`DROP INDEX IF EXISTS growth.uq_growth_import_tpl_team`);
    // Volver al índice único global exige que no haya nombres repetidos:
    // las personales archivadas o con nombre repetido se descartan.
    await q.query(
      `DELETE FROM ${T} t WHERE t.archived_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM ${T} o WHERE o.target = t.target AND lower(o.name) = lower(t.name)
                      AND o.id <> t.id AND o.scope = 'TEAM' AND t.scope = 'PERSONAL')`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_import_tpl_name ON ${T} (target, lower(name))`,
    );
    await q.query(`
      ALTER TABLE ${T}
        DROP CONSTRAINT IF EXISTS ck_growth_import_tpl_archived,
        DROP CONSTRAINT IF EXISTS ck_growth_import_tpl_scope,
        DROP COLUMN IF EXISTS archived_by_user_id,
        DROP COLUMN IF EXISTS archived_at,
        DROP COLUMN IF EXISTS updated_by_user_id,
        DROP COLUMN IF EXISTS owner_user_id,
        DROP COLUMN IF EXISTS scope`);
    const names = GROWTH_TEMPLATE_PERMISSION_ROWS.map((p) => p.name);
    for (const sql of [
      `DELETE FROM "role_permissions" rp USING "permissions" p WHERE p."id" = rp."permission_id" AND p."name"::text = ANY($1::text[])`,
      `DELETE FROM "user_permission_overrides" upo USING "permissions" p WHERE p."id" = upo."permission_id" AND p."name"::text = ANY($1::text[])`,
      `DELETE FROM "permission_dependencies" pd USING "permissions" p WHERE (p."id" = pd."permission_id" OR p."id" = pd."depends_on_id") AND p."name"::text = ANY($1::text[])`,
      `DELETE FROM "permissions" WHERE "name"::text = ANY($1::text[])`,
    ]) {
      await q.query(sql, [names]);
    }
  }
}
