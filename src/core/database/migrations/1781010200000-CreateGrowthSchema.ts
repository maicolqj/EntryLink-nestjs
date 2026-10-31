import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, fase 0 (3/3): esquema `growth` con las tablas base.
 *
 * Aislamiento: la ÚNICA llave foránea que sale del esquema apunta a
 * `public.users` (identidad). Nada en `public` apunta a `growth` y ninguna
 * tabla de conjuntos o residentes se referencia.
 *
 * Integridad en la base, no solo en la aplicación:
 *  - `activity_events` y `suppression_hashes` son append-only: un trigger
 *    rechaza UPDATE, DELETE y TRUNCATE.
 *  - `suppressions` no se borra nunca; el único UPDATE permitido es levantar
 *    una exclusión ACTIVE → LIFTED con soporte jurídico, sin tocar lo demás.
 *  - Una fuente no queda ACTIVE sin revisión jurídica aprobada, y una de pago
 *    tampoco sin presupuesto, tope y aprobación de costo.
 *
 * Reversión: `DROP SCHEMA growth CASCADE`. Con GROWTH_ENABLED apagada las
 * tablas están vacías, así que no hay pérdida. Las funciones de trigger viven
 * dentro del esquema y caen con él.
 */
export const GROWTH_ENTITY_TYPES = [
  'TEAM_MEMBER',
  'DATA_SOURCE',
  'SUPPRESSION',
  'DATA_SUBJECT_REQUEST',
  'LEGAL_HOLD',
];

const IN = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

export class CreateGrowthSchema1781010200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS growth`);

    // ── Funciones de protección ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION growth.reject_modification() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'growth.%: % no permitido (tabla append-only)', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION growth.guard_suppression_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status = 'ACTIVE' AND NEW.status = 'LIFTED'
           AND NEW.id = OLD.id
           AND NEW.identifier_type = OLD.identifier_type
           AND NEW.scope = OLD.scope
           AND NEW.reason = OLD.reason
           AND NEW.source_request_id IS NOT DISTINCT FROM OLD.source_request_id
           AND NEW.created_at = OLD.created_at
           AND NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id
        THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'growth.suppressions: solo se permite levantar una exclusión activa (ACTIVE -> LIFTED) sin modificar sus datos'
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$
    `);

    // ── Equipo comercial ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE growth.team_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        display_name varchar(120) NOT NULL,
        job_title varchar(80),
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        territories text[] NOT NULL DEFAULT '{}',
        max_active_assignments integer,
        joined_at timestamptz NOT NULL DEFAULT now(),
        left_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid,
        updated_by_user_id uuid,
        CONSTRAINT uq_growth_team_members_user UNIQUE (user_id),
        CONSTRAINT fk_growth_team_members_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_team_members_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_team_members_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_team_members_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT ck_growth_team_members_capacity CHECK (max_active_assignments IS NULL OR max_active_assignments > 0),
        CONSTRAINT ck_growth_team_members_left CHECK (left_at IS NULL OR left_at >= joined_at),
        CONSTRAINT ck_growth_team_members_inactive CHECK ((status = 'INACTIVE') = (left_at IS NOT NULL)),
        CONSTRAINT ck_growth_team_members_name CHECK (length(btrim(display_name)) > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_growth_team_members_status ON growth.team_members (status)`,
    );

    // ── Registro de actividad (append-only) ────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE growth.activity_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id uuid,
        actor_roles text[] NOT NULL DEFAULT '{}',
        action varchar(60) NOT NULL,
        entity_type varchar(40) NOT NULL,
        entity_id uuid NOT NULL,
        changes jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_growth_activity_actor FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_activity_action CHECK (action ~ '^[A-Z][A-Z_]{2,59}$'),
        CONSTRAINT ck_growth_activity_entity_type CHECK (entity_type IN (${IN(GROWTH_ENTITY_TYPES)})),
        CONSTRAINT ck_growth_activity_changes CHECK (changes IS NULL OR jsonb_typeof(changes) = 'object')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_growth_activity_actor ON growth.activity_events (actor_user_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_growth_activity_entity ON growth.activity_events (entity_type, entity_id, created_at DESC)`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_growth_activity_events_no_update_delete
      BEFORE UPDATE OR DELETE ON growth.activity_events
      FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_growth_activity_events_no_truncate
      BEFORE TRUNCATE ON growth.activity_events
      FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_modification()
    `);

    // ── Catálogo de fuentes ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE growth.data_sources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(40) NOT NULL,
        name varchar(120) NOT NULL,
        kind varchar(30) NOT NULL,
        base_url text,
        terms_summary text NOT NULL,
        processing_purpose text NOT NULL,
        allows_automation boolean NOT NULL DEFAULT false,
        legal_review_status varchar(20) NOT NULL DEFAULT 'PENDING',
        legal_review_reference text,
        legal_reviewed_by_user_id uuid,
        legal_reviewed_at timestamptz,
        requires_cost_approval boolean NOT NULL DEFAULT false,
        monthly_budget_cop numeric(14, 2),
        monthly_request_cap integer,
        cost_estimate_notes text,
        cost_approved_by_user_id uuid,
        cost_approved_at timestamptz,
        status varchar(20) NOT NULL DEFAULT 'PENDING_APPROVAL',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid,
        updated_by_user_id uuid,
        deleted_at timestamptz,
        CONSTRAINT uq_growth_data_sources_code UNIQUE (code),
        CONSTRAINT fk_growth_sources_legal_by FOREIGN KEY (legal_reviewed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_sources_cost_by FOREIGN KEY (cost_approved_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_sources_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_sources_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_sources_code CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
        CONSTRAINT ck_growth_sources_kind CHECK (kind IN ('PUBLIC_REGISTRY', 'CORPORATE_WEBSITE', 'PUBLIC_DIRECTORY', 'PAID_API', 'SUPPLIED_BY_SUBJECT', 'MANUAL_RESEARCH', 'SECTOR_SOURCE', 'REFERRAL')),
        CONSTRAINT ck_growth_sources_status CHECK (status IN ('ACTIVE', 'PENDING_APPROVAL', 'DISABLED')),
        CONSTRAINT ck_growth_sources_legal_status CHECK (legal_review_status IN ('PENDING', 'APPROVED', 'REJECTED')),
        CONSTRAINT ck_growth_sources_legal_trace CHECK (
          legal_review_status = 'PENDING'
          OR (legal_reviewed_at IS NOT NULL AND legal_reviewed_by_user_id IS NOT NULL AND legal_review_reference IS NOT NULL)
        ),
        CONSTRAINT ck_growth_sources_paid_requires_cost CHECK (kind <> 'PAID_API' OR requires_cost_approval),
        CONSTRAINT ck_growth_sources_cost_approval_only_when_required CHECK (cost_approved_at IS NULL OR requires_cost_approval),
        CONSTRAINT ck_growth_sources_cost_trace CHECK ((cost_approved_at IS NULL) = (cost_approved_by_user_id IS NULL)),
        CONSTRAINT ck_growth_sources_budget CHECK (monthly_budget_cop IS NULL OR monthly_budget_cop >= 0),
        CONSTRAINT ck_growth_sources_cap CHECK (monthly_request_cap IS NULL OR monthly_request_cap > 0),
        CONSTRAINT ck_growth_sources_active_legal CHECK (status <> 'ACTIVE' OR legal_review_status = 'APPROVED'),
        CONSTRAINT ck_growth_sources_active_cost CHECK (
          status <> 'ACTIVE' OR NOT requires_cost_approval
          OR (cost_approved_at IS NOT NULL AND monthly_budget_cop IS NOT NULL AND monthly_request_cap IS NOT NULL)
        ),
        CONSTRAINT ck_growth_sources_deleted_not_active CHECK (deleted_at IS NULL OR status <> 'ACTIVE')
      )
    `);

    // Semilla: ninguna fuente nace activa; todas esperan revisión jurídica.
    const sources: Array<
      [string, string, string, string | null, string, boolean]
    > = [
      [
        'MANUAL_RESEARCH',
        'Investigación manual',
        'MANUAL_RESEARCH',
        null,
        'Consulta humana caso por caso de información publicada por la propia empresa. Sin extracción automatizada.',
        false,
      ],
      [
        'RUES',
        'Registro Único Empresarial y Social (RUES)',
        'PUBLIC_REGISTRY',
        'https://www.rues.org.co',
        'Consulta individual de registro mercantil. Sin extracción masiva ni automatizada; respetar los términos de uso del portal.',
        false,
      ],
      [
        'CORPORATE_WEBSITE',
        'Sitio web corporativo',
        'CORPORATE_WEBSITE',
        null,
        'Datos de contacto empresarial publicados por la propia empresa. Respetar robots.txt y términos del sitio. Sin extracción automatizada.',
        false,
      ],
      [
        'PUBLIC_DIRECTORY',
        'Directorio empresarial público',
        'PUBLIC_DIRECTORY',
        null,
        'Solo directorios cuyos términos permitan la consulta para contacto comercial. Validar caso por caso.',
        false,
      ],
      [
        'SUPPLIED_BY_SUBJECT',
        'Suministrada por la empresa o el titular',
        'SUPPLIED_BY_SUBJECT',
        null,
        'Información entregada directamente por la empresa o el titular, con su autorización registrada.',
        false,
      ],
      [
        'GOOGLE_PLACES',
        'Google Places API',
        'PAID_API',
        'https://developers.google.com/maps/documentation/places',
        'API de pago. Requiere aprobación expresa de costo, presupuesto mensual y tope de consultas antes de usarse. Respetar las políticas de almacenamiento de Google Maps Platform.',
        true,
      ],
    ];
    for (const [code, name, kind, url, terms, paid] of sources) {
      await queryRunner.query(
        `INSERT INTO growth.data_sources (code, name, kind, base_url, terms_summary, processing_purpose, allows_automation, requires_cost_approval)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7)`,
        [
          code,
          name,
          kind,
          url,
          terms,
          'Identificación y contacto comercial B2B de empresas administradoras de propiedad horizontal y copropiedades en Colombia. Finalidad pendiente de validación jurídica.',
          paid,
        ],
      );
    }

    // ── Solicitudes de titulares (Ley 1581) ────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE growth.data_subject_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_type varchar(20) NOT NULL,
        channel varchar(20) NOT NULL,
        subject_identifier_type varchar(20) NOT NULL,
        subject_key_version smallint NOT NULL,
        subject_identifier_hash char(64) NOT NULL,
        subject_contact text,
        contact_redacted_at timestamptz,
        received_at timestamptz NOT NULL,
        due_at timestamptz NOT NULL,
        extended_due_at timestamptz,
        extension_reason text,
        status varchar(20) NOT NULL DEFAULT 'RECEIVED',
        resolution_notes text,
        resolved_at timestamptz,
        handled_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid,
        updated_by_user_id uuid,
        CONSTRAINT fk_growth_dsr_handled_by FOREIGN KEY (handled_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_dsr_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_dsr_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_dsr_type CHECK (request_type IN ('ACCESS', 'RECTIFICATION', 'DELETION', 'REVOCATION', 'OBJECTION')),
        CONSTRAINT ck_growth_dsr_channel CHECK (channel IN ('EMAIL', 'PHONE', 'WEB', 'WRITTEN')),
        CONSTRAINT ck_growth_dsr_identifier_type CHECK (subject_identifier_type IN ('EMAIL', 'PHONE', 'NIT', 'DOMAIN')),
        CONSTRAINT ck_growth_dsr_key_version CHECK (subject_key_version > 0),
        CONSTRAINT ck_growth_dsr_hash CHECK (subject_identifier_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_growth_dsr_status CHECK (status IN ('RECEIVED', 'IN_PROGRESS', 'EXTENDED', 'RESOLVED', 'REJECTED')),
        CONSTRAINT ck_growth_dsr_due CHECK (due_at > received_at),
        CONSTRAINT ck_growth_dsr_extension CHECK (extended_due_at IS NULL OR (extended_due_at > due_at AND extension_reason IS NOT NULL)),
        CONSTRAINT ck_growth_dsr_extended_status CHECK (status <> 'EXTENDED' OR extended_due_at IS NOT NULL),
        CONSTRAINT ck_growth_dsr_closed CHECK ((status IN ('RESOLVED', 'REJECTED')) = (resolved_at IS NOT NULL)),
        CONSTRAINT ck_growth_dsr_closed_notes CHECK (resolved_at IS NULL OR (resolution_notes IS NOT NULL AND handled_by_user_id IS NOT NULL)),
        CONSTRAINT ck_growth_dsr_redacted CHECK (contact_redacted_at IS NULL OR subject_contact IS NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_growth_dsr_status_due ON growth.data_subject_requests (status, due_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_growth_dsr_subject ON growth.data_subject_requests (subject_identifier_type, subject_key_version, subject_identifier_hash)`,
    );

    // ── Lista de exclusión (dato mínimo: solo hashes) ──────────────────────
    await queryRunner.query(`
      CREATE TABLE growth.suppressions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        identifier_type varchar(20) NOT NULL,
        scope varchar(20) NOT NULL DEFAULT 'ALL_CHANNELS',
        reason varchar(30) NOT NULL,
        source_request_id uuid,
        status varchar(10) NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid,
        lifted_at timestamptz,
        lifted_by_user_id uuid,
        lift_legal_basis text,
        lift_evidence_reference text,
        CONSTRAINT uq_growth_suppressions_id_type UNIQUE (id, identifier_type),
        CONSTRAINT fk_growth_suppressions_request FOREIGN KEY (source_request_id) REFERENCES growth.data_subject_requests(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_suppressions_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_suppressions_lifted_by FOREIGN KEY (lifted_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_suppressions_type CHECK (identifier_type IN ('EMAIL', 'PHONE', 'NIT', 'DOMAIN')),
        CONSTRAINT ck_growth_suppressions_scope CHECK (scope IN ('ALL_CHANNELS', 'EMAIL', 'PHONE', 'WHATSAPP')),
        CONSTRAINT ck_growth_suppressions_reason CHECK (reason IN ('SUBJECT_REQUEST', 'UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'INTERNAL')),
        CONSTRAINT ck_growth_suppressions_status CHECK (status IN ('ACTIVE', 'LIFTED')),
        CONSTRAINT ck_growth_suppressions_lift CHECK (
          (status = 'ACTIVE' AND lifted_at IS NULL AND lifted_by_user_id IS NULL AND lift_legal_basis IS NULL AND lift_evidence_reference IS NULL)
          OR
          (status = 'LIFTED' AND lifted_at IS NOT NULL AND lifted_by_user_id IS NOT NULL
            AND length(btrim(lift_legal_basis)) >= 10 AND length(btrim(lift_evidence_reference)) >= 3)
        ),
        CONSTRAINT ck_growth_suppressions_request_reason CHECK (source_request_id IS NULL OR reason = 'SUBJECT_REQUEST')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_growth_suppressions_status ON growth.suppressions (status)`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_growth_suppressions_guard_update
      BEFORE UPDATE ON growth.suppressions
      FOR EACH ROW EXECUTE FUNCTION growth.guard_suppression_update()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_growth_suppressions_no_delete
      BEFORE DELETE ON growth.suppressions
      FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_growth_suppressions_no_truncate
      BEFORE TRUNCATE ON growth.suppressions
      FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_modification()
    `);

    // Un hash por versión de llave: rotar la llave agrega filas, nunca reescribe.
    await queryRunner.query(`
      CREATE TABLE growth.suppression_hashes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        suppression_id uuid NOT NULL,
        identifier_type varchar(20) NOT NULL,
        key_version smallint NOT NULL,
        identifier_hash char(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_growth_suppression_hashes_suppression FOREIGN KEY (suppression_id, identifier_type)
          REFERENCES growth.suppressions(id, identifier_type) ON DELETE RESTRICT,
        CONSTRAINT uq_growth_suppression_hashes_version UNIQUE (suppression_id, key_version),
        CONSTRAINT ck_growth_suppression_hashes_version CHECK (key_version > 0),
        CONSTRAINT ck_growth_suppression_hashes_hash CHECK (identifier_hash ~ '^[0-9a-f]{64}$')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_growth_suppression_hashes_lookup ON growth.suppression_hashes (identifier_type, key_version, identifier_hash)`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_growth_suppression_hashes_no_update_delete
      BEFORE UPDATE OR DELETE ON growth.suppression_hashes
      FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_growth_suppression_hashes_no_truncate
      BEFORE TRUNCATE ON growth.suppression_hashes
      FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_modification()
    `);

    // ── Retenciones legales ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE growth.legal_holds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar(40) NOT NULL,
        entity_id uuid NOT NULL,
        legal_basis text NOT NULL,
        hold_until date NOT NULL,
        released_at timestamptz,
        released_by_user_id uuid,
        release_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid NOT NULL,
        CONSTRAINT fk_growth_holds_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_growth_holds_released_by FOREIGN KEY (released_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_holds_entity_type CHECK (entity_type IN (${IN(GROWTH_ENTITY_TYPES)})),
        CONSTRAINT ck_growth_holds_basis CHECK (length(btrim(legal_basis)) >= 10),
        CONSTRAINT ck_growth_holds_until CHECK (hold_until > created_at::date AND hold_until <= (created_at + interval '10 years')::date),
        CONSTRAINT ck_growth_holds_release CHECK (
          (released_at IS NULL AND released_by_user_id IS NULL AND release_reason IS NULL)
          OR (released_at IS NOT NULL AND released_by_user_id IS NOT NULL AND length(btrim(release_reason)) >= 10)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_growth_holds_active ON growth.legal_holds (entity_type, entity_id) WHERE released_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS growth CASCADE`);
  }
}
