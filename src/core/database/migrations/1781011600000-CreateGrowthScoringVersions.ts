import { MigrationInterface, QueryRunner } from 'typeorm';
import { GROWTH_ENTITY_TYPES } from './1781010200000-CreateGrowthSchema';
import { PROSPECT_ENTITY_TYPES } from './1781010500000-CreateGrowthProspects';
import { DEDUPE_ENTITY_TYPES } from './1781010800000-CreateGrowthDedupeAndScoring';
import { IMPORT_ENTITY_TYPES } from './1781011100000-CreateGrowthImports';

/**
 * Versiones de scoring con aprobación (1E-C-0, 2/2).
 *
 * - `growth.scoring_versions`: conjuntos inmutables de reglas y umbrales.
 *   DRAFT → ACTIVE (solo con aprobación) → RETIRED; un borrador descartado
 *   pasa a RETIRED sin haber estado activo. Una sola ACTIVE. Fuera de
 *   DRAFT, reglas, umbrales y notas no cambian (trigger), y nada se borra.
 * - `growth.prospect_score_history`: append-only; cada puntaje distinto que
 *   tuvo un prospecto, con la versión que lo produjo.
 * - `prospect_scores.version_id`: qué versión calculó el puntaje vigente.
 * - Versión 1, ACTIVE, con las reglas y umbrales vigentes al migrar: no se
 *   cambian (origen MIGRATION, sin aprobador).
 * - Permiso APPROVE_GROWTH_SCORING, INACTIVO y SIN rol (el token toma los
 *   permisos del rol sin mirar su estado). Se activa con el SQL de
 *   docs/growth/ACTIVATION.md.
 *
 * Copia fija del catálogo; su spec falla si se separan.
 */
export const GROWTH_SCORING_APPROVAL_PERMISSION_ROWS = [
  {
    id: '8c1d7e54-2a96-4f0b-b3e1-5d47a90c6f12',
    name: 'APPROVE_GROWTH_SCORING',
    label: 'Aprobar Scoring',
    description:
      'Aprobar y activar una versión de reglas y umbrales del scoring comercial',
    level: 'HIGH',
    dependsOn: ['VIEW_GROWTH_PROSPECTS'],
  },
];

export const SCORING_VERSION_ENTITY_TYPES = ['SCORING_VERSION'];

export const SCORING_VERSION_TRANSITIONS: Array<[string, string]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'RETIRED'],
  ['ACTIVE', 'RETIRED'],
];

const IN = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

const BEFORE = [
  ...GROWTH_ENTITY_TYPES,
  ...PROSPECT_ENTITY_TYPES,
  ...DEDUPE_ENTITY_TYPES,
  ...IMPORT_ENTITY_TYPES,
];

const entityTypesCheck = async (q: QueryRunner, values: string[]) => {
  for (const [table, constraint] of [
    ['activity_events', 'ck_growth_activity_entity_type'],
    ['legal_holds', 'ck_growth_holds_entity_type'],
  ]) {
    await q.query(
      `ALTER TABLE growth.${table} DROP CONSTRAINT IF EXISTS ${constraint}`,
    );
    await q.query(
      `ALTER TABLE growth.${table} ADD CONSTRAINT ${constraint} CHECK (entity_type IN (${IN(values)}))`,
    );
  }
};

/**
 * Siembra la versión 1 con lo vigente en `scoring_rules` y `settings` si no
 * hay ninguna. La usa también la limpieza de las pruebas de integración.
 */
export const SEED_INITIAL_SCORING_VERSION_SQL = `
  INSERT INTO growth.scoring_versions
    (number, status, origin, rules, thresholds, notes, approved_at, activated_at, contributor_user_ids)
  SELECT 1, 'ACTIVE', 'MIGRATION',
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                     'key', r.key, 'label', r.label, 'predicate', r.predicate, 'params', r.params,
                     'points', r.points, 'appliesTo', to_jsonb(r.applies_to), 'active', r.active,
                     'sortOrder', r.sort_order) ORDER BY r.sort_order, r.key)
                     FROM growth.scoring_rules r), '[]'::jsonb),
         (SELECT jsonb_build_object('high', s.scoring_high_threshold, 'medium', s.scoring_medium_threshold)
            FROM growth.settings s WHERE s.id = 1),
         'Versión inicial: reglas y umbrales vigentes al introducir el versionado',
         now(), now(), '{}'::uuid[]
   WHERE NOT EXISTS (SELECT 1 FROM growth.scoring_versions)`;

export class CreateGrowthScoringVersions1781011600000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    for (const p of GROWTH_SCORING_APPROVAL_PERMISSION_ROWS) {
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

    await entityTypesCheck(q, [...BEFORE, ...SCORING_VERSION_ENTITY_TYPES]);

    await q.query(`
      CREATE TABLE growth.scoring_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        number int NOT NULL UNIQUE,
        status varchar(10) NOT NULL DEFAULT 'DRAFT',
        origin varchar(10) NOT NULL DEFAULT 'USER',
        rules jsonb NOT NULL,
        thresholds jsonb NOT NULL,
        notes varchar(1000),
        based_on_version_id uuid REFERENCES growth.scoring_versions(id) ON DELETE RESTRICT,
        created_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        contributor_user_ids uuid[] NOT NULL DEFAULT '{}',
        approved_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        approved_at timestamptz,
        self_approval_exception boolean NOT NULL DEFAULT false,
        activated_at timestamptz,
        retired_at timestamptz,
        retired_reason varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_scoring_version_status CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
        CONSTRAINT ck_growth_scoring_version_origin CHECK (origin IN ('USER', 'MIGRATION')),
        CONSTRAINT ck_growth_scoring_version_author CHECK (origin = 'MIGRATION' OR created_by_user_id IS NOT NULL),
        -- Solo la versión 1 puede venir de la migración (y quedar activa sin aprobador).
        CONSTRAINT ck_growth_scoring_version_migration CHECK (origin <> 'MIGRATION' OR number = 1),
        CONSTRAINT ck_growth_scoring_version_rules CHECK (jsonb_typeof(rules) = 'array'),
        CONSTRAINT ck_growth_scoring_version_thresholds CHECK (
          jsonb_typeof(thresholds) = 'object'
          AND jsonb_typeof(thresholds->'high') = 'number' AND jsonb_typeof(thresholds->'medium') = 'number'
          AND (thresholds->>'medium')::numeric >= 0 AND (thresholds->>'high')::numeric <= 100
          AND (thresholds->>'medium')::numeric < (thresholds->>'high')::numeric),
        -- Activa: aprobada y activada; aprobador salvo la versión migrada.
        CONSTRAINT ck_growth_scoring_version_active CHECK (
          status <> 'ACTIVE' OR (approved_at IS NOT NULL AND activated_at IS NOT NULL
                                 AND (approved_by_user_id IS NOT NULL OR origin = 'MIGRATION'))),
        CONSTRAINT ck_growth_scoring_version_retired CHECK (status <> 'RETIRED' OR retired_at IS NOT NULL),
        CONSTRAINT ck_growth_scoring_version_self CHECK (NOT self_approval_exception OR approved_by_user_id IS NOT NULL)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_scoring_version_active ON growth.scoring_versions ((true)) WHERE status = 'ACTIVE'`,
    );
    await q.query(
      `CREATE INDEX ix_growth_scoring_version_status ON growth.scoring_versions (status, number DESC)`,
    );

    const allowed = SCORING_VERSION_TRANSITIONS.map(
      ([a, b]) => `('${a}','${b}')`,
    ).join(', ');
    await q.query(`
      CREATE OR REPLACE FUNCTION growth.guard_scoring_version() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status = 'RETIRED' THEN
          RAISE EXCEPTION 'growth.scoring_versions: una versión retirada no se modifica'
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status
           AND (OLD.status, NEW.status) NOT IN (${allowed}) THEN
          RAISE EXCEPTION 'growth.scoring_versions: transición % -> % no permitida', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
        END IF;
        IF OLD.status <> 'DRAFT' AND (
             NEW.rules IS DISTINCT FROM OLD.rules
          OR NEW.thresholds IS DISTINCT FROM OLD.thresholds
          OR NEW.notes IS DISTINCT FROM OLD.notes
          OR NEW.contributor_user_ids IS DISTINCT FROM OLD.contributor_user_ids) THEN
          RAISE EXCEPTION 'growth.scoring_versions: reglas, umbrales y notas no cambian fuera del borrador'
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.number IS DISTINCT FROM OLD.number
           OR NEW.origin IS DISTINCT FROM OLD.origin
           OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
           OR NEW.based_on_version_id IS DISTINCT FROM OLD.based_on_version_id THEN
          RAISE EXCEPTION 'growth.scoring_versions: número, origen y autor no cambian'
            USING ERRCODE = 'check_violation';
        END IF;
        IF OLD.approved_at IS NOT NULL AND (
             NEW.approved_at IS DISTINCT FROM OLD.approved_at
          OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id
          OR NEW.self_approval_exception IS DISTINCT FROM OLD.self_approval_exception
          OR NEW.activated_at IS DISTINCT FROM OLD.activated_at) THEN
          RAISE EXCEPTION 'growth.scoring_versions: la aprobación no cambia'
            USING ERRCODE = 'check_violation';
        END IF;
        NEW.updated_at := now();
        RETURN NEW;
      END; $$`);
    await q.query(`
      CREATE TRIGGER trg_growth_scoring_version_guard
      BEFORE UPDATE ON growth.scoring_versions
      FOR EACH ROW EXECUTE FUNCTION growth.guard_scoring_version()`);
    await q.query(
      `CREATE TRIGGER trg_growth_scoring_version_no_delete BEFORE DELETE ON growth.scoring_versions FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()`,
    );
    await q.query(
      `CREATE TRIGGER trg_growth_scoring_version_no_truncate BEFORE TRUNCATE ON growth.scoring_versions FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_modification()`,
    );

    await q.query(`
      CREATE TABLE growth.prospect_score_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid REFERENCES growth.organizations(id) ON DELETE RESTRICT,
        person_id uuid REFERENCES growth.people(id) ON DELETE RESTRICT,
        score int NOT NULL,
        priority varchar(10) NOT NULL,
        breakdown jsonb NOT NULL,
        has_estimates boolean NOT NULL,
        version_id uuid NOT NULL REFERENCES growth.scoring_versions(id) ON DELETE RESTRICT,
        rules_version int NOT NULL,
        computed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_score_history_target CHECK ((organization_id IS NULL) <> (person_id IS NULL)),
        CONSTRAINT ck_growth_score_history_priority CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
        CONSTRAINT ck_growth_score_history_score CHECK (score BETWEEN 0 AND 100)
      )`);
    await q.query(
      `CREATE INDEX ix_growth_score_history_org ON growth.prospect_score_history (organization_id, computed_at DESC) WHERE organization_id IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_score_history_person ON growth.prospect_score_history (person_id, computed_at DESC) WHERE person_id IS NOT NULL`,
    );
    await q.query(
      `CREATE TRIGGER trg_growth_score_history_no_update_delete BEFORE UPDATE OR DELETE ON growth.prospect_score_history FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()`,
    );
    await q.query(
      `CREATE TRIGGER trg_growth_score_history_no_truncate BEFORE TRUNCATE ON growth.prospect_score_history FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_modification()`,
    );

    await q.query(
      `ALTER TABLE growth.prospect_scores ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES growth.scoring_versions(id) ON DELETE RESTRICT`,
    );

    // Versión 1: lo vigente, sin cambiar reglas ni umbrales.
    await q.query(SEED_INITIAL_SCORING_VERSION_SQL);
    // Los puntajes calculados con la versión de reglas vigente son de la v1;
    // los demás quedan sin versión y el recálculo pendiente los pone al día.
    await q.query(`
      UPDATE growth.prospect_scores ps
         SET version_id = v.id
        FROM growth.scoring_versions v, growth.settings s
       WHERE v.status = 'ACTIVE' AND s.id = 1 AND ps.rules_version = s.scoring_version`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE growth.prospect_scores DROP COLUMN IF EXISTS version_id`,
    );
    await q.query(`DROP TABLE IF EXISTS growth.prospect_score_history`);
    await q.query(`DROP TABLE IF EXISTS growth.scoring_versions`);
    await q.query(`DROP FUNCTION IF EXISTS growth.guard_scoring_version()`);
    // La actividad es append-only: sus eventos SCORING_VERSION se conservan,
    // así que el CHECK de tipos de entidad queda ampliado (es inocuo).
    const names = GROWTH_SCORING_APPROVAL_PERMISSION_ROWS.map((p) => p.name);
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
