import { MigrationInterface, QueryRunner } from 'typeorm';
import { PROSPECT_ENTITY_TYPES } from './1781010500000-CreateGrowthProspects';
import { DEDUPE_ENTITY_TYPES } from './1781010800000-CreateGrowthDedupeAndScoring';

/**
 * Growth Suite, entrega 1C (3/3): importaciones CSV/XLSX.
 *
 *  - `import_batches`: un lote por archivo, con la fuente (ACTIVE al subir),
 *    el mapeo, los conteos y su estado. Las transiciones las vigila un
 *    trigger; un lote purgado ya no cambia.
 *  - `import_files`: el archivo original en `bytea` (máx. 5 MB), en su propia
 *    tabla para que listar lotes no lo cargue. No va a R2: la suite no importa
 *    `core/` y así los datos personales no salen del esquema `growth`.
 *  - `import_rows`: fila cruda, valores normalizados, errores (sin copiar el
 *    valor), pista de duplicado y decisión. `CREATE` con errores no pasa el
 *    CHECK.
 *  - `import_mapping_templates`: mapeos guardados por encabezado.
 *
 * Purga (ajuste D): a los 30 días de terminado el lote se borra el archivo y
 * quedan en NULL `raw`, `mapped` y `duplicate_hint` (cron en la app).
 */

const IN = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

const PHASE0_ENTITY_TYPES = [
  'TEAM_MEMBER',
  'DATA_SOURCE',
  'SUPPRESSION',
  'DATA_SUBJECT_REQUEST',
  'LEGAL_HOLD',
];

export const IMPORT_ENTITY_TYPES = ['IMPORT_BATCH', 'IMPORT_TEMPLATE'];

export const IMPORT_TARGETS = ['ORGANIZATIONS', 'PROPERTIES', 'PEOPLE'];

export const IMPORT_STATUSES = [
  'UPLOADED',
  'MAPPED',
  'VALIDATING',
  'VALIDATED',
  'COMMITTING',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
];

export const IMPORT_TERMINAL_STATUSES = ['COMMITTED', 'FAILED', 'CANCELLED'];

export const IMPORT_TRANSITIONS: Array<[string, string]> = [
  ['UPLOADED', 'MAPPED'],
  ['UPLOADED', 'CANCELLED'],
  ['MAPPED', 'VALIDATING'],
  ['MAPPED', 'FAILED'],
  ['MAPPED', 'CANCELLED'],
  ['VALIDATING', 'VALIDATED'],
  ['VALIDATING', 'FAILED'],
  ['VALIDATING', 'CANCELLED'],
  ['VALIDATED', 'MAPPED'],
  ['VALIDATED', 'COMMITTING'],
  ['VALIDATED', 'CANCELLED'],
  ['COMMITTING', 'COMMITTED'],
  ['COMMITTING', 'FAILED'],
];

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

const entityTypesCheck = async (q: QueryRunner, values: string[]) => {
  const all = IN(values);
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
};

export class CreateGrowthImports1781011100000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await entityTypesCheck(q, [
      ...PHASE0_ENTITY_TYPES,
      ...PROSPECT_ENTITY_TYPES,
      ...DEDUPE_ENTITY_TYPES,
      ...IMPORT_ENTITY_TYPES,
    ]);

    // ── Lotes ──────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.import_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        target varchar(20) NOT NULL,
        source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
        source_url text,
        consulted_at timestamptz NOT NULL,
        reliability varchar(10) NOT NULL,
        source_notes text,
        file_name varchar(255) NOT NULL,
        file_kind varchar(10) NOT NULL,
        file_size integer NOT NULL,
        file_sha256 char(64) NOT NULL,
        headers text[] NOT NULL,
        column_mapping jsonb,
        person_channel_class varchar(20),
        status varchar(20) NOT NULL DEFAULT 'UPLOADED',
        status_reason text,
        total_rows integer NOT NULL,
        valid_rows integer NOT NULL DEFAULT 0,
        error_rows integer NOT NULL DEFAULT 0,
        duplicate_rows integer NOT NULL DEFAULT 0,
        suppressed_values integer NOT NULL DEFAULT 0,
        created_rows integer NOT NULL DEFAULT 0,
        linked_rows integer NOT NULL DEFAULT 0,
        skipped_rows integer NOT NULL DEFAULT 0,
        failed_rows integer NOT NULL DEFAULT 0,
        created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        committed_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        validated_at timestamptz,
        committed_at timestamptz,
        finished_at timestamptz,
        purged_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_import_target CHECK (target IN (${IN(IMPORT_TARGETS)})),
        CONSTRAINT ck_growth_import_status CHECK (status IN (${IN(IMPORT_STATUSES)})),
        CONSTRAINT ck_growth_import_reliability CHECK (reliability IN ('HIGH', 'MEDIUM', 'LOW')),
        CONSTRAINT ck_growth_import_file_kind CHECK (file_kind IN ('CSV', 'XLSX')),
        CONSTRAINT ck_growth_import_file_size CHECK (file_size > 0 AND file_size <= ${IMPORT_MAX_BYTES}),
        CONSTRAINT ck_growth_import_sha CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_growth_import_rows CHECK (total_rows BETWEEN 1 AND ${IMPORT_MAX_ROWS}),
        CONSTRAINT ck_growth_import_headers CHECK (cardinality(headers) BETWEEN 1 AND 100),
        CONSTRAINT ck_growth_import_mapping CHECK (column_mapping IS NULL OR jsonb_typeof(column_mapping) = 'array'),
        CONSTRAINT ck_growth_import_channel_class CHECK (
          person_channel_class IS NULL OR (target = 'PEOPLE' AND person_channel_class IN ('PROFESSIONAL', 'DIRECT'))
        ),
        CONSTRAINT ck_growth_import_mapped CHECK (status IN ('UPLOADED', 'CANCELLED') OR column_mapping IS NOT NULL),
        CONSTRAINT ck_growth_import_counts CHECK (
          LEAST(valid_rows, error_rows, duplicate_rows, suppressed_values, created_rows, linked_rows, skipped_rows, failed_rows) >= 0
          AND valid_rows + error_rows <= total_rows
          AND created_rows + linked_rows + skipped_rows + failed_rows <= total_rows
        ),
        CONSTRAINT ck_growth_import_finished CHECK (
          (status IN (${IN(IMPORT_TERMINAL_STATUSES)})) = (finished_at IS NOT NULL)
        ),
        CONSTRAINT ck_growth_import_committed CHECK (
          status <> 'COMMITTED' OR (committed_at IS NOT NULL AND committed_by_user_id IS NOT NULL)
        ),
        CONSTRAINT ck_growth_import_purged CHECK (purged_at IS NULL OR finished_at IS NOT NULL)
      )`);
    await q.query(
      `CREATE INDEX ix_growth_import_sha ON growth.import_batches (file_sha256)`,
    );
    await q.query(
      `CREATE INDEX ix_growth_import_owner ON growth.import_batches (created_by_user_id, created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX ix_growth_import_purge ON growth.import_batches (finished_at) WHERE purged_at IS NULL AND finished_at IS NOT NULL`,
    );

    const allowed = IMPORT_TRANSITIONS.map(([a, b]) => `('${a}','${b}')`).join(
      ', ',
    );
    await q.query(`
      CREATE OR REPLACE FUNCTION growth.guard_import_batch() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.purged_at IS NOT NULL THEN
          RAISE EXCEPTION 'growth.import_batches: un lote purgado no se modifica'
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status
           AND (OLD.status, NEW.status) NOT IN (${allowed}) THEN
          RAISE EXCEPTION 'growth.import_batches: transición % -> % no permitida', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.target IS DISTINCT FROM OLD.target
           OR NEW.source_id IS DISTINCT FROM OLD.source_id
           OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
           OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
          RAISE EXCEPTION 'growth.import_batches: destino, fuente, archivo y autor no cambian'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END; $$`);
    await q.query(`
      CREATE TRIGGER trg_growth_import_batch_guard
      BEFORE UPDATE ON growth.import_batches
      FOR EACH ROW EXECUTE FUNCTION growth.guard_import_batch()`);
    await q.query(
      `CREATE TRIGGER trg_growth_import_batch_no_delete BEFORE DELETE ON growth.import_batches FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()`,
    );

    // ── Archivo original ───────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.import_files (
        batch_id uuid PRIMARY KEY REFERENCES growth.import_batches(id) ON DELETE RESTRICT,
        content bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_import_file_bytes CHECK (octet_length(content) BETWEEN 1 AND ${IMPORT_MAX_BYTES})
      )`);

    // ── Filas ──────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.import_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id uuid NOT NULL REFERENCES growth.import_batches(id) ON DELETE RESTRICT,
        row_number integer NOT NULL,
        raw jsonb,
        mapped jsonb,
        errors jsonb NOT NULL DEFAULT '[]',
        warnings jsonb NOT NULL DEFAULT '[]',
        duplicate_hint jsonb,
        suggested_decision varchar(20),
        decision varchar(20),
        decided_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        link_entity_id uuid,
        result varchar(20),
        result_entity_id uuid,
        result_error varchar(60),
        processed_at timestamptz,
        CONSTRAINT uq_growth_import_row UNIQUE (batch_id, row_number),
        CONSTRAINT ck_growth_import_row_number CHECK (row_number > 0),
        CONSTRAINT ck_growth_import_row_raw CHECK (raw IS NULL OR jsonb_typeof(raw) = 'array'),
        CONSTRAINT ck_growth_import_row_mapped CHECK (mapped IS NULL OR jsonb_typeof(mapped) = 'object'),
        CONSTRAINT ck_growth_import_row_errors CHECK (jsonb_typeof(errors) = 'array' AND jsonb_typeof(warnings) = 'array'),
        CONSTRAINT ck_growth_import_row_decision CHECK (
          (decision IS NULL OR decision IN ('CREATE', 'SKIP', 'LINK_EXISTING'))
          AND (suggested_decision IS NULL OR suggested_decision IN ('CREATE', 'SKIP', 'LINK_EXISTING'))
        ),
        CONSTRAINT ck_growth_import_row_create CHECK (decision IS DISTINCT FROM 'CREATE' OR jsonb_array_length(errors) = 0),
        CONSTRAINT ck_growth_import_row_link CHECK ((decision = 'LINK_EXISTING') = (link_entity_id IS NOT NULL)),
        CONSTRAINT ck_growth_import_row_result CHECK (
          result IS NULL OR (result IN ('CREATED', 'LINKED', 'SKIPPED', 'FAILED') AND processed_at IS NOT NULL)
        ),
        CONSTRAINT ck_growth_import_row_entity CHECK (
          (result IN ('CREATED', 'LINKED')) = (result_entity_id IS NOT NULL)
        )
      )`);
    await q.query(
      `CREATE INDEX ix_growth_import_rows_pending ON growth.import_rows (batch_id, row_number) WHERE result IS NULL`,
    );

    // ── Plantillas de mapeo ────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.import_mapping_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        target varchar(20) NOT NULL,
        name varchar(80) NOT NULL,
        column_mapping jsonb NOT NULL,
        created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_import_tpl_target CHECK (target IN (${IN(IMPORT_TARGETS)})),
        CONSTRAINT ck_growth_import_tpl_mapping CHECK (jsonb_typeof(column_mapping) = 'array' AND jsonb_array_length(column_mapping) > 0)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_import_tpl_name ON growth.import_mapping_templates (target, lower(name))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS growth.import_mapping_templates`);
    await q.query(`DROP TABLE IF EXISTS growth.import_rows`);
    await q.query(`DROP TABLE IF EXISTS growth.import_files`);
    await q.query(`DROP TABLE IF EXISTS growth.import_batches`);
    await q.query(`DROP FUNCTION IF EXISTS growth.guard_import_batch()`);
    // Si ya hay eventos de lotes, el down falla a propósito antes que perder
    // auditoría (igual que 1A y 1B).
    await entityTypesCheck(q, [
      ...PHASE0_ENTITY_TYPES,
      ...PROSPECT_ENTITY_TYPES,
      ...DEDUPE_ENTITY_TYPES,
    ]);
  }
}
