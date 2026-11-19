import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, entrega 1A (3/3): modelo de EntryLink Prospect.
 *
 * Empresas, personas y copropiedades con sus canales; vínculos laborales y
 * administraciones con historial; evidencias por campo; asignaciones con
 * historial; configuración de la suite.
 *
 * Reglas que impone la BASE (no solo la aplicación):
 *  - Transiciones de validación permitidas (trigger) y trazabilidad de quién
 *    validó.
 *  - Bloqueo jurídico: una persona solo puede quedar con contacto AUTHORIZED
 *    con base jurídica distinta de PENDING_LEGAL_REVIEW, documentada y
 *    revisada. `v_contactable_person_channels` es el único punto de entrada
 *    que usará Outreach.
 *  - Una sola administración vigente por copropiedad y un solo responsable
 *    vigente por prospecto.
 *  - Evidencias sin borrado (trigger); se marcan OBSOLETE.
 *
 * Aislamiento: FKs solo dentro de growth o hacia public.users.
 * Reversión: borra las tablas de 1A y restaura los CHECK de tipos de entidad.
 */

export const BOGOTA_LOCALITIES = [
  'USAQUEN',
  'CHAPINERO',
  'SANTA_FE',
  'SAN_CRISTOBAL',
  'USME',
  'TUNJUELITO',
  'BOSA',
  'KENNEDY',
  'FONTIBON',
  'ENGATIVA',
  'SUBA',
  'BARRIOS_UNIDOS',
  'TEUSAQUILLO',
  'LOS_MARTIRES',
  'ANTONIO_NARINO',
  'PUENTE_ARANDA',
  'LA_CANDELARIA',
  'RAFAEL_URIBE_URIBE',
  'CIUDAD_BOLIVAR',
  'SUMAPAZ',
];

const PHASE0_ENTITY_TYPES = [
  'TEAM_MEMBER',
  'DATA_SOURCE',
  'SUPPRESSION',
  'DATA_SUBJECT_REQUEST',
  'LEGAL_HOLD',
];

export const PROSPECT_ENTITY_TYPES = [
  'ORGANIZATION',
  'PERSON',
  'PROPERTY',
  'ORGANIZATION_CHANNEL',
  'PERSON_CHANNEL',
  'EMPLOYMENT',
  'PROPERTY_MANAGEMENT',
  'EVIDENCE',
  'PROSPECT_ASSIGNMENT',
  'SETTINGS',
];

export const VALIDATION_TRANSITIONS: Array<[string, string]> = [
  ['NEW', 'PENDING_REVIEW'],
  ['NEW', 'INCOMPLETE'],
  ['NEW', 'DUPLICATE'],
  ['INCOMPLETE', 'PENDING_REVIEW'],
  ['PENDING_REVIEW', 'IN_VALIDATION'],
  ['IN_VALIDATION', 'PENDING_REVIEW'],
  ['IN_VALIDATION', 'VALIDATED'],
  ['IN_VALIDATION', 'REJECTED'],
  ['IN_VALIDATION', 'INCOMPLETE'],
  ['IN_VALIDATION', 'DUPLICATE'],
  ['VALIDATED', 'PENDING_REVIEW'],
  ['REJECTED', 'PENDING_REVIEW'],
];

const IN = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

const VALIDATION_STATUSES = IN([
  'NEW',
  'PENDING_REVIEW',
  'IN_VALIDATION',
  'VALIDATED',
  'REJECTED',
  'DUPLICATE',
  'INCOMPLETE',
]);

/** Columnas comunes de validación + auditoría. */
const validationColumns = (t: string) => `
  validation_status varchar(20) NOT NULL DEFAULT 'NEW',
  validation_taken_by_user_id uuid,
  validated_by_user_id uuid,
  validated_at timestamptz,
  validation_note text,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid,
  deleted_at timestamptz,
  CONSTRAINT ck_growth_${t}_validation_status CHECK (validation_status IN (${VALIDATION_STATUSES})),
  CONSTRAINT ck_growth_${t}_validated CHECK (validation_status <> 'VALIDATED' OR (validated_by_user_id IS NOT NULL AND validated_at IS NOT NULL)),
  CONSTRAINT ck_growth_${t}_in_validation CHECK (validation_status <> 'IN_VALIDATION' OR validation_taken_by_user_id IS NOT NULL),
  CONSTRAINT fk_growth_${t}_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_growth_${t}_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_growth_${t}_validated_by FOREIGN KEY (validated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_growth_${t}_taken_by FOREIGN KEY (validation_taken_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT`;

const localityCheck = (t: string) =>
  `CONSTRAINT ck_growth_${t}_locality CHECK (locality IS NULL OR locality IN (${IN(BOGOTA_LOCALITIES)}))`;

const channelTable = (
  t: string,
  owner: string,
  ownerTable: string,
  extra: string,
) => `
  CREATE TABLE growth.${t} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ${owner} uuid NOT NULL REFERENCES growth.${ownerTable}(id) ON DELETE RESTRICT,
    kind varchar(20) NOT NULL,
    social_network varchar(30),
    value text NOT NULL,
    value_normalized text NOT NULL,
    label varchar(60),
    ${extra}
    verified_at timestamptz,
    verified_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
    source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    deleted_at timestamptz,
    CONSTRAINT ck_growth_${t}_kind CHECK (kind IN ('PHONE', 'EMAIL', 'WEBSITE', 'SOCIAL')),
    CONSTRAINT ck_growth_${t}_social CHECK ((kind = 'SOCIAL') = (social_network IS NOT NULL)),
    CONSTRAINT ck_growth_${t}_verified CHECK ((verified_at IS NULL) = (verified_by_user_id IS NULL))
  )`;

export class CreateGrowthProspects1781010500000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // ── Tipos de entidad: se amplían los CHECK de la fase 0 ────────────────
    const all = IN([...PHASE0_ENTITY_TYPES, ...PROSPECT_ENTITY_TYPES]);
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

    // ── Configuración de la suite (fila única) ─────────────────────────────
    await q.query(`
      CREATE TABLE growth.settings (
        id smallint PRIMARY KEY DEFAULT 1,
        allow_super_admin_self_validation boolean NOT NULL DEFAULT true,
        prospect_goal integer NOT NULL DEFAULT 100,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_settings_single CHECK (id = 1),
        CONSTRAINT ck_growth_settings_goal CHECK (prospect_goal > 0)
      )`);
    await q.query(`INSERT INTO growth.settings (id) VALUES (1)`);
    await q.query(`
      CREATE OR REPLACE FUNCTION growth.reject_settings_delete() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'growth.settings: la configuración no se borra' USING ERRCODE = 'insufficient_privilege';
      END; $$`);
    await q.query(
      `CREATE TRIGGER trg_growth_settings_no_delete BEFORE DELETE OR TRUNCATE ON growth.settings FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_settings_delete()`,
    );

    // ── Transiciones de validación (trigger compartido) ────────────────────
    const transitions = VALIDATION_TRANSITIONS.map(
      ([a, b]) => `('${a}','${b}')`,
    ).join(', ');
    await q.query(`
      CREATE OR REPLACE FUNCTION growth.guard_validation_transition() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.validation_status IS DISTINCT FROM OLD.validation_status
           AND (OLD.validation_status, NEW.validation_status) NOT IN (${transitions}) THEN
          RAISE EXCEPTION 'growth.%: transición de validación % -> % no permitida',
            TG_TABLE_NAME, OLD.validation_status, NEW.validation_status
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END; $$`);

    // ── Empresas administradoras ───────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        legal_name varchar(200) NOT NULL,
        trade_name varchar(200),
        name_normalized varchar(200) NOT NULL,
        nit varchar(12),
        nit_check_digit char(1),
        website text,
        domain varchar(253),
        address text,
        address_normalized text,
        city varchar(60) NOT NULL DEFAULT 'BOGOTA',
        locality varchar(30),
        estimated_properties integer,
        estimated_units integer,
        interest_signal varchar(20) NOT NULL DEFAULT 'NONE',
        source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
        ${validationColumns('organizations')},
        CONSTRAINT ck_growth_organizations_nit CHECK (nit IS NULL OR nit ~ '^[0-9]{6,10}$'),
        CONSTRAINT ck_growth_organizations_dv CHECK (nit_check_digit IS NULL OR nit_check_digit ~ '^[0-9]$'),
        CONSTRAINT ck_growth_organizations_estimates CHECK (coalesce(estimated_properties, 0) >= 0 AND coalesce(estimated_units, 0) >= 0),
        CONSTRAINT ck_growth_organizations_interest CHECK (interest_signal IN ('NONE', 'EXPRESSED', 'DEMO_REQUESTED')),
        CONSTRAINT ck_growth_organizations_name CHECK (length(btrim(legal_name)) > 1),
        ${localityCheck('organizations')}
      )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_organizations_nit ON growth.organizations (nit) WHERE nit IS NOT NULL AND deleted_at IS NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_organizations_status ON growth.organizations (validation_status) WHERE deleted_at IS NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_organizations_name ON growth.organizations (name_normalized)`,
    );

    // ── Personas (dato personal) ───────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.people (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name varchar(160) NOT NULL,
        name_normalized varchar(160) NOT NULL,
        is_independent_admin boolean NOT NULL DEFAULT false,
        source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
        processing_purpose text NOT NULL,
        legal_basis varchar(30) NOT NULL DEFAULT 'PENDING_LEGAL_REVIEW',
        legal_basis_reference text,
        legal_basis_reviewed_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        legal_basis_reviewed_at timestamptz,
        contact_status varchar(20) NOT NULL DEFAULT 'NOT_AUTHORIZED',
        contact_authorized_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        contact_authorized_at timestamptz,
        contact_status_reason text,
        last_interaction_at timestamptz,
        anonymized_at timestamptz,
        ${validationColumns('people')},
        CONSTRAINT ck_growth_people_name CHECK (length(btrim(full_name)) > 1),
        CONSTRAINT ck_growth_people_purpose CHECK (length(btrim(processing_purpose)) >= 10),
        CONSTRAINT ck_growth_people_legal_basis CHECK (legal_basis IN ('PENDING_LEGAL_REVIEW', 'PUBLIC_DATA', 'PRIOR_AUTHORIZATION', 'CONTRACT', 'LEGAL_OBLIGATION')),
        CONSTRAINT ck_growth_people_legal_trace CHECK (
          legal_basis = 'PENDING_LEGAL_REVIEW'
          OR (legal_basis_reference IS NOT NULL AND length(btrim(legal_basis_reference)) >= 5
              AND legal_basis_reviewed_by_user_id IS NOT NULL AND legal_basis_reviewed_at IS NOT NULL)
        ),
        CONSTRAINT ck_growth_people_contact_status CHECK (contact_status IN ('NOT_AUTHORIZED', 'AUTHORIZED', 'REVOKED')),
        CONSTRAINT ck_growth_people_contact_requires_basis CHECK (
          contact_status <> 'AUTHORIZED'
          OR (legal_basis <> 'PENDING_LEGAL_REVIEW'
              AND legal_basis_reference IS NOT NULL
              AND legal_basis_reviewed_at IS NOT NULL
              AND contact_authorized_by_user_id IS NOT NULL
              AND contact_authorized_at IS NOT NULL
              AND anonymized_at IS NULL
              AND deleted_at IS NULL)
        )
      )`);
    // Fecha de revisión de retención: 12 meses desde la última verificación o
    // interacción (no autoriza conservar indefinidamente). Trigger y no
    // columna generada: timestamptz + interval no es inmutable.
    await q.query(
      `ALTER TABLE growth.people ADD COLUMN retention_review_at timestamptz NOT NULL DEFAULT now() + interval '12 months'`,
    );
    await q.query(`
      CREATE OR REPLACE FUNCTION growth.set_retention_review() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        NEW.retention_review_at := greatest(
          coalesce(NEW.last_verified_at, NEW.created_at),
          coalesce(NEW.last_interaction_at, NEW.created_at),
          NEW.created_at
        ) + interval '12 months';
        RETURN NEW;
      END; $$`);
    await q.query(
      `CREATE TRIGGER trg_growth_people_retention BEFORE INSERT OR UPDATE ON growth.people FOR EACH ROW EXECUTE FUNCTION growth.set_retention_review()`,
    );
    await q.query(
      `CREATE INDEX ix_growth_people_status ON growth.people (validation_status) WHERE deleted_at IS NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_people_name ON growth.people (name_normalized)`,
    );
    await q.query(
      `CREATE INDEX ix_growth_people_retention ON growth.people (retention_review_at) WHERE anonymized_at IS NULL AND deleted_at IS NULL`,
    );

    // ── Copropiedades ──────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(200) NOT NULL,
        name_normalized varchar(200) NOT NULL,
        ph_type varchar(20) NOT NULL DEFAULT 'RESIDENCIAL',
        building_kind varchar(30) NOT NULL DEFAULT 'OTRO',
        address text,
        address_normalized text,
        city varchar(60) NOT NULL DEFAULT 'BOGOTA',
        locality varchar(30),
        neighborhood varchar(120),
        estimated_units integer,
        real_estate_registration varchar(40),
        nit varchar(12),
        info_status varchar(20) NOT NULL DEFAULT 'PARTIAL',
        source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
        ${validationColumns('properties')},
        CONSTRAINT ck_growth_properties_name CHECK (length(btrim(name)) > 1),
        CONSTRAINT ck_growth_properties_ph_type CHECK (ph_type IN ('RESIDENCIAL', 'MIXTA', 'COMERCIAL')),
        CONSTRAINT ck_growth_properties_kind CHECK (building_kind IN ('CONJUNTO_CASAS', 'CONJUNTO_APARTAMENTOS', 'EDIFICIO', 'MIXTO', 'OTRO')),
        CONSTRAINT ck_growth_properties_units CHECK (estimated_units IS NULL OR estimated_units > 0),
        CONSTRAINT ck_growth_properties_nit CHECK (nit IS NULL OR nit ~ '^[0-9]{6,10}$'),
        CONSTRAINT ck_growth_properties_info CHECK (info_status IN ('PARTIAL', 'COMPLETE', 'OUTDATED')),
        ${localityCheck('properties')}
      )`);
    await q.query(
      `CREATE INDEX ix_growth_properties_status ON growth.properties (validation_status) WHERE deleted_at IS NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_properties_name ON growth.properties (name_normalized)`,
    );

    for (const t of ['organizations', 'people', 'properties']) {
      await q.query(`
        CREATE TRIGGER trg_growth_${t}_validation_transition
        BEFORE UPDATE OF validation_status ON growth.${t}
        FOR EACH ROW EXECUTE FUNCTION growth.guard_validation_transition()`);
    }

    // ── Canales ─────────────────────────────────────────────────────────────
    await q.query(
      channelTable(
        'organization_channels',
        'organization_id',
        'organizations',
        '',
      ),
    );
    await q.query(
      `CREATE INDEX ix_growth_org_channels_value ON growth.organization_channels (kind, value_normalized) WHERE deleted_at IS NULL`,
    );
    await q.query(
      channelTable(
        'person_channels',
        'person_id',
        'people',
        `channel_class varchar(20) NOT NULL,
       CONSTRAINT ck_growth_person_channels_class CHECK (channel_class IN ('PROFESSIONAL', 'DIRECT')),`,
      ),
    );
    await q.query(
      `CREATE INDEX ix_growth_person_channels_value ON growth.person_channels (kind, value_normalized) WHERE deleted_at IS NULL`,
    );

    // ── Vínculos laborales (historial) ─────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.employments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        person_id uuid NOT NULL REFERENCES growth.people(id) ON DELETE RESTRICT,
        organization_id uuid NOT NULL REFERENCES growth.organizations(id) ON DELETE RESTRICT,
        role_title varchar(120),
        started_on date,
        ended_on date,
        status varchar(20) NOT NULL DEFAULT 'UNCONFIRMED',
        source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_employments_status CHECK (status IN ('CURRENT', 'PAST', 'UNCONFIRMED')),
        CONSTRAINT ck_growth_employments_dates CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on),
        CONSTRAINT ck_growth_employments_past CHECK ((status = 'PAST') = (ended_on IS NOT NULL))
      )`);
    await q.query(
      `CREATE INDEX ix_growth_employments_person ON growth.employments (person_id)`,
    );
    await q.query(
      `CREATE INDEX ix_growth_employments_org ON growth.employments (organization_id)`,
    );

    // ── Administración de copropiedades (historial) ────────────────────────
    await q.query(`
      CREATE TABLE growth.property_managements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id uuid NOT NULL REFERENCES growth.properties(id) ON DELETE RESTRICT,
        manager_type varchar(20) NOT NULL,
        organization_id uuid REFERENCES growth.organizations(id) ON DELETE RESTRICT,
        person_id uuid REFERENCES growth.people(id) ON DELETE RESTRICT,
        responsible_person_id uuid REFERENCES growth.people(id) ON DELETE RESTRICT,
        started_on date,
        ended_on date,
        status varchar(20) NOT NULL DEFAULT 'UNCONFIRMED',
        source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_pm_type CHECK (manager_type IN ('ORGANIZATION', 'PERSON', 'SELF_MANAGED')),
        CONSTRAINT ck_growth_pm_coherence CHECK (
          (manager_type = 'ORGANIZATION' AND organization_id IS NOT NULL AND person_id IS NULL)
          OR (manager_type = 'PERSON' AND person_id IS NOT NULL AND organization_id IS NULL AND responsible_person_id IS NULL)
          OR (manager_type = 'SELF_MANAGED' AND organization_id IS NULL AND person_id IS NULL)
        ),
        CONSTRAINT ck_growth_pm_status CHECK (status IN ('CURRENT', 'PAST', 'UNCONFIRMED')),
        CONSTRAINT ck_growth_pm_dates CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on),
        CONSTRAINT ck_growth_pm_past CHECK ((status = 'PAST') = (ended_on IS NOT NULL))
      )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_pm_current ON growth.property_managements (property_id) WHERE status = 'CURRENT'`,
    );
    await q.query(
      `CREATE INDEX ix_growth_pm_org ON growth.property_managements (organization_id) WHERE organization_id IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_pm_person ON growth.property_managements (person_id) WHERE person_id IS NOT NULL`,
    );

    // ── Evidencias ──────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.evidences (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar(40) NOT NULL,
        entity_id uuid NOT NULL,
        field varchar(60) NOT NULL,
        observed_value text,
        source_id uuid NOT NULL REFERENCES growth.data_sources(id) ON DELETE RESTRICT,
        url text,
        consulted_at timestamptz NOT NULL,
        reliability varchar(10) NOT NULL DEFAULT 'MEDIUM',
        verification_status varchar(20) NOT NULL DEFAULT 'UNVERIFIED',
        verified_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        verified_at timestamptz,
        notes text,
        captured_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_growth_evidences_entity CHECK (entity_type IN (${IN(PROSPECT_ENTITY_TYPES.filter((t) => !['EVIDENCE', 'PROSPECT_ASSIGNMENT', 'SETTINGS'].includes(t)))})),
        CONSTRAINT ck_growth_evidences_reliability CHECK (reliability IN ('HIGH', 'MEDIUM', 'LOW')),
        CONSTRAINT ck_growth_evidences_status CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'DISPUTED', 'OBSOLETE')),
        CONSTRAINT ck_growth_evidences_verified CHECK (verification_status IN ('UNVERIFIED') OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)),
        CONSTRAINT ck_growth_evidences_consulted CHECK (consulted_at <= created_at + interval '5 minutes')
      )`);
    await q.query(
      `CREATE INDEX ix_growth_evidences_entity ON growth.evidences (entity_type, entity_id, field)`,
    );
    await q.query(
      `CREATE TRIGGER trg_growth_evidences_no_delete BEFORE DELETE ON growth.evidences FOR EACH ROW EXECUTE FUNCTION growth.reject_modification()`,
    );
    await q.query(
      `CREATE TRIGGER trg_growth_evidences_no_truncate BEFORE TRUNCATE ON growth.evidences FOR EACH STATEMENT EXECUTE FUNCTION growth.reject_modification()`,
    );

    // ── Asignaciones (historial) ───────────────────────────────────────────
    await q.query(`
      CREATE TABLE growth.prospect_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid REFERENCES growth.organizations(id) ON DELETE RESTRICT,
        person_id uuid REFERENCES growth.people(id) ON DELETE RESTRICT,
        property_id uuid REFERENCES growth.properties(id) ON DELETE RESTRICT,
        team_member_id uuid NOT NULL REFERENCES growth.team_members(id) ON DELETE RESTRICT,
        assigned_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        reason text,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        ended_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_growth_assign_one_target CHECK (num_nonnulls(organization_id, person_id, property_id) = 1),
        CONSTRAINT ck_growth_assign_dates CHECK (ended_at IS NULL OR ended_at >= started_at),
        CONSTRAINT ck_growth_assign_end_trace CHECK ((ended_at IS NULL) = (ended_by_user_id IS NULL))
      )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_assign_org ON growth.prospect_assignments (organization_id) WHERE ended_at IS NULL AND organization_id IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_assign_person ON growth.prospect_assignments (person_id) WHERE ended_at IS NULL AND person_id IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_growth_assign_property ON growth.prospect_assignments (property_id) WHERE ended_at IS NULL AND property_id IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX ix_growth_assign_member ON growth.prospect_assignments (team_member_id) WHERE ended_at IS NULL`,
    );

    // ── Único punto de entrada de Outreach (fase 3) ────────────────────────
    // Solo canales verificados de personas con contacto AUTHORIZED. La lista
    // de exclusión (HMAC) la debe consultar además el servicio de envío.
    await q.query(`
      CREATE VIEW growth.v_contactable_person_channels AS
      SELECT c.id AS channel_id, c.person_id, c.kind, c.channel_class, c.value, p.legal_basis
        FROM growth.person_channels c
        JOIN growth.people p ON p.id = c.person_id
       WHERE c.deleted_at IS NULL
         AND c.verified_at IS NOT NULL
         AND c.kind IN ('EMAIL', 'PHONE')
         AND p.deleted_at IS NULL
         AND p.anonymized_at IS NULL
         AND p.contact_status = 'AUTHORIZED'
         AND p.legal_basis <> 'PENDING_LEGAL_REVIEW'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP VIEW IF EXISTS growth.v_contactable_person_channels`);
    for (const t of [
      'prospect_assignments',
      'evidences',
      'property_managements',
      'employments',
      'person_channels',
      'organization_channels',
      'properties',
      'people',
      'organizations',
      'settings',
    ]) {
      await q.query(`DROP TABLE IF EXISTS growth.${t}`);
    }
    await q.query(
      `DROP FUNCTION IF EXISTS growth.guard_validation_transition()`,
    );
    await q.query(`DROP FUNCTION IF EXISTS growth.reject_settings_delete()`);
    await q.query(`DROP FUNCTION IF EXISTS growth.set_retention_review()`);

    // Los CHECK vuelven a los tipos de la fase 0 (las filas de 1A en
    // activity_events no se pueden borrar: si existen, el down falla a
    // propósito antes que perder auditoría).
    const phase0 = IN(PHASE0_ENTITY_TYPES);
    await q.query(
      `ALTER TABLE growth.activity_events DROP CONSTRAINT ck_growth_activity_entity_type`,
    );
    await q.query(
      `ALTER TABLE growth.activity_events ADD CONSTRAINT ck_growth_activity_entity_type CHECK (entity_type IN (${phase0}))`,
    );
    await q.query(
      `ALTER TABLE growth.legal_holds DROP CONSTRAINT ck_growth_holds_entity_type`,
    );
    await q.query(
      `ALTER TABLE growth.legal_holds ADD CONSTRAINT ck_growth_holds_entity_type CHECK (entity_type IN (${phase0}))`,
    );
  }
}
