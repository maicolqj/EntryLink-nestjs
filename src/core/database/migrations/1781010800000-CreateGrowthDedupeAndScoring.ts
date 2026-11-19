import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PROSPECT_ENTITY_TYPES,
  VALIDATION_TRANSITIONS,
} from './1781010500000-CreateGrowthProspects';

/**
 * Growth Suite, entrega 1B (3/3): deduplicación, fusión manual y scoring.
 *
 *  - `merged_into_id` en empresas, personas y copropiedades: el registro
 *    absorbido no se borra; queda DUPLICATE y apunta al sobreviviente. El
 *    trigger permite `* -> DUPLICATE` solo junto con `merged_into_id`, y un
 *    registro fusionado ya no cambia.
 *  - `duplicate_candidates`: pares a revisar por una persona (nunca se fusiona
 *    solo).
 *  - `merge_log`: append-only (trigger), con la elección por campo y lo
 *    trasladado.
 *  - Scoring: reglas con lista cerrada de predicados, umbrales y versión en
 *    `growth.settings`, un puntaje vigente por prospecto.
 *
 * Sin pg_trgm: la similitud de nombres se calcula en la aplicación (evita
 * depender del permiso CREATE EXTENSION en producción).
 */

const IN = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

const PHASE0_ENTITY_TYPES = [
  'TEAM_MEMBER',
  'DATA_SOURCE',
  'SUPPRESSION',
  'DATA_SUBJECT_REQUEST',
  'LEGAL_HOLD',
];

export const DEDUPE_ENTITY_TYPES = ['DUPLICATE_CANDIDATE', 'SCORING_RULE'];

export const SCORING_PREDICATES = [
  'PROPERTIES_GTE',
  'PROPERTIES_BETWEEN',
  'UNITS_GT',
  'VERIFIED_CHANNEL',
  'INTEREST_SIGNAL_IN',
];

/** Reglas aprobadas por el responsable del producto (plan §5, §14). */
export const SEED_SCORING_RULES: Array<{
  key: string;
  label: string;
  predicate: string;
  params: Record<string, unknown>;
  points: number;
  appliesTo: string[];
  sortOrder: number;
}> = [
  {
    key: 'PROPERTIES_10_PLUS',
    label: 'Administra 10 o más copropiedades',
    predicate: 'PROPERTIES_GTE',
    params: { min: 10 },
    points: 40,
    appliesTo: ['ORGANIZATION', 'PERSON'],
    sortOrder: 10,
  },
  {
    key: 'PROPERTIES_5_TO_9',
    label: 'Administra de 5 a 9 copropiedades',
    predicate: 'PROPERTIES_BETWEEN',
    params: { min: 5, max: 9 },
    points: 30,
    appliesTo: ['ORGANIZATION', 'PERSON'],
    sortOrder: 20,
  },
  {
    key: 'PROPERTIES_2_TO_4',
    label: 'Administra de 2 a 4 copropiedades',
    predicate: 'PROPERTIES_BETWEEN',
    params: { min: 2, max: 4 },
    points: 20,
    appliesTo: ['ORGANIZATION', 'PERSON'],
    sortOrder: 30,
  },
  {
    key: 'UNITS_500_PLUS',
    label: 'Más de 500 unidades estimadas',
    predicate: 'UNITS_GT',
    params: { value: 500 },
    points: 20,
    appliesTo: ['ORGANIZATION', 'PERSON'],
    sortOrder: 40,
  },
  {
    key: 'VERIFIED_CHANNEL',
    label: 'Canal corporativo o profesional verificado',
    predicate: 'VERIFIED_CHANNEL',
    params: {},
    points: 10,
    appliesTo: ['ORGANIZATION', 'PERSON'],
    sortOrder: 50,
  },
  {
    key: 'INTEREST_SHOWN',
    label: 'Interés demostrado en EntryLink',
    predicate: 'INTEREST_SIGNAL_IN',
    params: { values: ['EXPRESSED', 'DEMO_REQUESTED'] },
    points: 20,
    appliesTo: ['ORGANIZATION', 'PERSON'],
    sortOrder: 60,
  },
];

const transitionsSql = (withMerge: boolean) => {
  const allowed = VALIDATION_TRANSITIONS.map(
    ([a, b]) => `('${a}','${b}')`,
  ).join(', ');
  const mergeGuard = withMerge
    ? `
        IF OLD.merged_into_id IS NOT NULL THEN
          RAISE EXCEPTION 'growth.%: un registro fusionado no se modifica', TG_TABLE_NAME
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.merged_into_id IS NOT NULL AND NEW.validation_status = 'DUPLICATE' THEN
          RETURN NEW;
        END IF;`
    : '';
  return `
    CREATE OR REPLACE FUNCTION growth.guard_validation_transition() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN${mergeGuard}
      IF NEW.validation_status IS DISTINCT FROM OLD.validation_status
         AND (OLD.validation_status, NEW.validation_status) NOT IN (${allowed}) THEN
        RAISE EXCEPTION 'growth.%: transición de validación % -> % no permitida',
          TG_TABLE_NAME, OLD.validation_status, NEW.validation_status
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END; $$`;
};

export class CreateGrowthDedupeAndScoring1781010800000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // ── Tipos de entidad ───────────────────────────────────────────────────
    const all = IN([
      ...PHASE0_ENTITY_TYPES,
      ...PROSPECT_ENTITY_TYPES,
      ...DEDUPE_ENTITY_TYPES,
    ]);
    await q.query(
      `ALTER TABLE growth.activity_events DROP CONSTRAINT ck_growth_activity_entity_type`,
    );
    await q.query(
      `ALTER TABLE growth.activity_events ADD CONSTRAINT ck_growth_activity_entity_type CHECK (entity_type IN (${all}))`,
    );
    await q.query(
      `ALTER TABLE growth.legal_holds DROP CONSTRAINT ck_growth_holds_entity_type`,
    );
    await q.query(
      `ALTER TABLE growth.legal_holds ADD CONSTRAINT ck_growth_holds_entity_type CHECK (entity_type IN (${all}))`,
    );

    // ── Fusión: merged_into_id ─────────────────────────────────────────────
    for (const t of ['organizations', 'people', 'properties']) {
      await q.query(
        `ALTER TABLE growth.${t} ADD COLUMN merged_into_id uuid REFERENCES growth.${t}(id) ON DELETE RESTRICT`,
      );
      await q.query(`
        ALTER TABLE growth.${t} ADD CONSTRAINT ck_growth_${t}_merged
          CHECK (merged_into_id IS NULL OR (validation_status = 'DUPLICATE' AND merged_into_id <> id))`);
      await q.query(
        `CREATE INDEX ix_growth_${t}_merged ON growth.${t} (merged_into_id) WHERE merged_into_id IS NOT NULL`,
      );
      await q.query(
        `DROP TRIGGER trg_growth_${t}_validation_transition ON growth.${t}`,
      );
    }
    await q.query(transitionsSql(true));
    for (const t of ['organizations', 'people', 'properties']) {
      await q.query(`
        CREATE TRIGGER trg_growth_${t}_validation_transition
        BEFORE UPDATE OF validation_status, merged_into_id ON growth.${t}
        FOR EACH ROW EXECUTE FUNCTION growth.guard_validation_transition()`);
    }

    // Interés demostrado también para administradores independientes.
    await q.query(
      `ALTER TABLE growth.people ADD COLUMN interest_signal varchar(20) NOT NULL DEFAULT 'NONE'`,
    );
    await q.query(
      `ALTER TABLE growth.people ADD CONSTRAINT ck_growth_people_interest CHECK (interest_signal IN ('NONE', 'EXPRESSED', 'DEMO_REQUESTED'))`,
    );

    // ── Candidatos de duplicado ────────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.duplicate_candidates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar(20) NOT NULL,
        left_id uuid NOT NULL,
        right_id uuid NOT NULL,
        matched_on text[] NOT NULL,
        score numeric(5, 2) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        resolved_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        resolved_at timestamptz,
        resolution_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_dup_entity CHECK (entity_type IN ('ORGANIZATION', 'PERSON', 'PROPERTY')),
        CONSTRAINT ck_growth_dup_order CHECK (left_id < right_id),
        CONSTRAINT ck_growth_dup_score CHECK (score > 0 AND score <= 100),
        CONSTRAINT ck_growth_dup_matched CHECK (cardinality(matched_on) > 0),
        CONSTRAINT ck_growth_dup_status CHECK (status IN ('PENDING', 'MERGED', 'DISMISSED')),
        CONSTRAINT ck_growth_dup_resolved CHECK (
          (status = 'PENDING' AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
          OR (status <> 'PENDING' AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL)
        ),
        CONSTRAINT uq_growth_dup_pair UNIQUE (entity_type, left_id, right_id)
      )`);
    await q.query(
      `CREATE INDEX ix_growth_dup_pending ON growth.duplicate_candidates (entity_type, score DESC) WHERE status = 'PENDING'`,
    );

    // ── Bitácora de fusiones (append-only) ────────────────────────────────
    await q.query(`
      CREATE TABLE growth.merge_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar(20) NOT NULL,
        survivor_id uuid NOT NULL,
        merged_id uuid NOT NULL,
        candidate_id uuid REFERENCES growth.duplicate_candidates(id) ON DELETE RESTRICT,
        field_choices jsonb NOT NULL,
        moved jsonb NOT NULL,
        merged_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_merge_entity CHECK (entity_type IN ('ORGANIZATION', 'PERSON', 'PROPERTY')),
        CONSTRAINT ck_growth_merge_distinct CHECK (survivor_id <> merged_id)
      )`);
    await q.query(
      `CREATE TRIGGER trg_growth_merge_log_no_update_delete BEFORE UPDATE OR DELETE ON growth.merge_log FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()`,
    );
    await q.query(
      `CREATE TRIGGER trg_growth_merge_log_no_truncate BEFORE TRUNCATE ON growth.merge_log FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_modification()`,
    );

    // ── Scoring ────────────────────────────────────────────────────────────
    await q.query(
      `ALTER TABLE growth.settings ADD COLUMN scoring_high_threshold integer NOT NULL DEFAULT 50`,
    );
    await q.query(
      `ALTER TABLE growth.settings ADD COLUMN scoring_medium_threshold integer NOT NULL DEFAULT 25`,
    );
    await q.query(
      `ALTER TABLE growth.settings ADD COLUMN scoring_version integer NOT NULL DEFAULT 1`,
    );
    await q.query(`
      ALTER TABLE growth.settings ADD CONSTRAINT ck_growth_settings_thresholds
        CHECK (scoring_medium_threshold >= 0 AND scoring_high_threshold > scoring_medium_threshold AND scoring_version > 0)`);

    await q.query(`
      CREATE TABLE growth.scoring_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(40) NOT NULL UNIQUE,
        label varchar(120) NOT NULL,
        predicate varchar(30) NOT NULL,
        params jsonb NOT NULL DEFAULT '{}',
        points integer NOT NULL,
        applies_to text[] NOT NULL,
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_rules_key CHECK (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
        CONSTRAINT ck_growth_rules_predicate CHECK (predicate IN (${IN(SCORING_PREDICATES)})),
        CONSTRAINT ck_growth_rules_points CHECK (points BETWEEN -100 AND 100),
        CONSTRAINT ck_growth_rules_params CHECK (jsonb_typeof(params) = 'object'),
        CONSTRAINT ck_growth_rules_applies CHECK (cardinality(applies_to) > 0 AND applies_to <@ ARRAY['ORGANIZATION', 'PERSON']::text[])
      )`);
    for (const r of SEED_SCORING_RULES) {
      await q.query(
        `INSERT INTO growth.scoring_rules (key, label, predicate, params, points, applies_to, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::text[], $7)`,
        [
          r.key,
          r.label,
          r.predicate,
          JSON.stringify(r.params),
          r.points,
          r.appliesTo,
          r.sortOrder,
        ],
      );
    }

    await q.query(`
      CREATE TABLE growth.prospect_scores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid REFERENCES growth.organizations(id) ON DELETE RESTRICT,
        person_id uuid REFERENCES growth.people(id) ON DELETE RESTRICT,
        score integer NOT NULL,
        priority varchar(10) NOT NULL,
        breakdown jsonb NOT NULL,
        has_estimates boolean NOT NULL,
        rules_version integer NOT NULL,
        computed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_scores_target CHECK (num_nonnulls(organization_id, person_id) = 1),
        CONSTRAINT ck_growth_scores_priority CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
        CONSTRAINT ck_growth_scores_breakdown CHECK (jsonb_typeof(breakdown) = 'array')
      )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_scores_org ON growth.prospect_scores (organization_id) WHERE organization_id IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_scores_person ON growth.prospect_scores (person_id) WHERE person_id IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_scores_rank ON growth.prospect_scores (priority, score DESC)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS growth.prospect_scores`);
    await q.query(`DROP TABLE IF EXISTS growth.scoring_rules`);
    await q.query(
      `ALTER TABLE growth.settings DROP CONSTRAINT IF EXISTS ck_growth_settings_thresholds`,
    );
    for (const c of [
      'scoring_high_threshold',
      'scoring_medium_threshold',
      'scoring_version',
    ]) {
      await q.query(`ALTER TABLE growth.settings DROP COLUMN IF EXISTS ${c}`);
    }
    await q.query(`DROP TABLE IF EXISTS growth.merge_log`);
    await q.query(`DROP TABLE IF EXISTS growth.duplicate_candidates`);
    await q.query(
      `ALTER TABLE growth.people DROP CONSTRAINT IF EXISTS ck_growth_people_interest`,
    );
    await q.query(
      `ALTER TABLE growth.people DROP COLUMN IF EXISTS interest_signal`,
    );

    for (const t of ['organizations', 'people', 'properties']) {
      await q.query(
        `DROP TRIGGER trg_growth_${t}_validation_transition ON growth.${t}`,
      );
      await q.query(
        `ALTER TABLE growth.${t} DROP CONSTRAINT IF EXISTS ck_growth_${t}_merged`,
      );
      await q.query(
        `ALTER TABLE growth.${t} DROP COLUMN IF EXISTS merged_into_id`,
      );
    }
    await q.query(transitionsSql(false));
    for (const t of ['organizations', 'people', 'properties']) {
      await q.query(`
        CREATE TRIGGER trg_growth_${t}_validation_transition
        BEFORE UPDATE OF validation_status ON growth.${t}
        FOR EACH ROW EXECUTE FUNCTION growth.guard_validation_transition()`);
    }

    // Igual que en 1A: si ya hay eventos de tipos de 1B, el down falla a
    // propósito antes que perder auditoría.
    const prev = IN([...PHASE0_ENTITY_TYPES, ...PROSPECT_ENTITY_TYPES]);
    await q.query(
      `ALTER TABLE growth.activity_events DROP CONSTRAINT ck_growth_activity_entity_type`,
    );
    await q.query(
      `ALTER TABLE growth.activity_events ADD CONSTRAINT ck_growth_activity_entity_type CHECK (entity_type IN (${prev}))`,
    );
    await q.query(
      `ALTER TABLE growth.legal_holds DROP CONSTRAINT ck_growth_holds_entity_type`,
    );
    await q.query(
      `ALTER TABLE growth.legal_holds ADD CONSTRAINT ck_growth_holds_entity_type CHECK (entity_type IN (${prev}))`,
    );
  }
}
