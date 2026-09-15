import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mascotas y gestión de convivencia.
 *
 * Tres tablas: la ficha (`pets`), el reporte de incumplimiento
 * (`pet_incidents`) y los descargos de la unidad señalada
 * (`pet_incident_statements`).
 *
 * Dos decisiones quedan garantizadas por la base, no por el servicio:
 *
 *   · `UQ_pet_incidents_complex_consecutive` — dos vecinos reportando en el
 *     mismo segundo no pueden llevarse el mismo número de expediente, que es
 *     lo que después se cita en la multa.
 *   · `UQ_pets_complex_microchip` (parcial) — el microchip es único por
 *     definición; el índice es parcial porque la mayoría de las fichas no lo
 *     tienen y varios NULL no deben chocar.
 *
 * Corre fuera de transacción porque agrega valores a los enums nativos de
 * notificaciones, igual que las migraciones de PQRF y votaciones.
 */
export class CreatePets1781005000000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Configuración del módulo en el complejo ──────────────────────────
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "pets_max_per_unit"              int     NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "pets_resident_reporting_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "pets_statement_days"            int     NOT NULL DEFAULT 5,
        ADD COLUMN IF NOT EXISTS "pets_expiry_reminder_days"      int     NOT NULL DEFAULT 30
    `);

    // ── Ficha de la mascota ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pets" (
        "id"                      uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "name"                    varchar(80)  NOT NULL,
        "species"                 varchar(20)  NOT NULL,
        "breed"                   varchar(80),
        "color"                   varchar(60),
        "distinguishing_marks"    text,
        "sex"                     varchar(20),
        "size"                    varchar(20),
        "birth_date"              date,
        "photo_url"               text,
        "has_microchip"           boolean      NOT NULL DEFAULT false,
        "microchip_code"          varchar(50),
        "is_special_breed"        boolean      NOT NULL DEFAULT false,
        "insurance_company"       varchar(120),
        "insurance_policy_number" varchar(60),
        "insurance_expires_at"    date,
        "vaccination_card_url"    text,
        "rabies_vaccine_at"       date,
        "sterilized"              boolean,
        "status"                  varchar(20)  NOT NULL DEFAULT 'PENDING_APPROVAL',
        "approved_at"             timestamptz,
        "rejection_reason"        text,
        "notes"                   text,
        "resident_id"             uuid,
        "unit_id"                 uuid         NOT NULL,
        "complex_id"              uuid         NOT NULL,
        "created_by_user_id"      uuid,
        "approved_by_user_id"     uuid,
        "created_at"              timestamptz  NOT NULL DEFAULT now(),
        "updated_at"              timestamptz  NOT NULL DEFAULT now(),
        "deleted_at"              timestamptz,
        CONSTRAINT "PK_pets_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pets_unit"
          FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pets_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pets_resident"
          FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pets_approved_by"
          FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pets_complex_status"
        ON "pets" ("complex_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pets_unit_status"
        ON "pets" ("unit_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pets_resident"
        ON "pets" ("resident_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pets_complex_microchip"
        ON "pets" ("complex_id", "microchip_code")
        WHERE "microchip_code" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // ── Reporte de convivencia ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pet_incidents" (
        "id"                  uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "code"                varchar(20)   NOT NULL,
        "consecutive"         int           NOT NULL,
        "type"                varchar(30)   NOT NULL,
        "severity"            varchar(20)   NOT NULL DEFAULT 'MEDIUM',
        "description"         text          NOT NULL,
        "photo_urls"          text[]        NOT NULL DEFAULT '{}',
        "photo_hashes"        text[]        NOT NULL DEFAULT '{}',
        "occurred_at"         timestamptz   NOT NULL,
        "location"            varchar(160),
        "lat"                 decimal(10,8),
        "lng"                 decimal(11,8),
        "pet_id"              uuid,
        "unit_id"             uuid,
        "reported_by_user_id" uuid,
        "reported_by_role"    varchar(50),
        "reported_by_name"    varchar(200),
        "reported_by_unit_id" uuid,
        "status"              varchar(20)   NOT NULL DEFAULT 'REPORTED',
        "reviewed_by_user_id" uuid,
        "reviewed_at"         timestamptz,
        "statement_due_at"    timestamptz,
        "resolution_notes"    text,
        "resolved_at"         timestamptz,
        "fine_amount"         numeric(14,2),
        "fine_charge_id"      uuid,
        "complex_id"          uuid          NOT NULL,
        "created_at"          timestamptz   NOT NULL DEFAULT now(),
        "updated_at"          timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"          timestamptz,
        CONSTRAINT "PK_pet_incidents_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pet_incidents_complex_consecutive" UNIQUE ("complex_id", "consecutive"),
        CONSTRAINT "FK_pet_incidents_pet"
          FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pet_incidents_unit"
          FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pet_incidents_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pet_incidents_complex_status"
        ON "pet_incidents" ("complex_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pet_incidents_pet"
        ON "pet_incidents" ("pet_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pet_incidents_unit_status"
        ON "pet_incidents" ("unit_id", "status")
    `);

    // ── Descargos de la unidad señalada ───────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pet_incident_statements" (
        "id"             uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "incident_id"    uuid         NOT NULL,
        "text"           text         NOT NULL,
        "image_urls"     text[]       NOT NULL DEFAULT '{}',
        "author_user_id" uuid,
        "author_role"    varchar(50),
        "author_name"    varchar(200),
        "complex_id"     uuid         NOT NULL,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pet_incident_statements_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pet_incident_statements_incident"
          FOREIGN KEY ("incident_id") REFERENCES "pet_incidents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pet_incident_statements_author"
          FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pet_incident_statements_incident"
        ON "pet_incident_statements" ("incident_id")
    `);

    // ── Tipos de notificación ─────────────────────────────────────────────
    // Sin estos labels los avisos se pierden en el INSERT, que va
    // fire-and-forget: el residente no se enteraría de que lo sancionaron.
    const notificationTypes = [
      'PET_REGISTERED',
      'PET_APPROVED',
      'PET_REJECTED',
      'PET_SUSPENDED',
      'PET_REACTIVATED',
      'PET_INCIDENT_REPORTED',
      'PET_INCIDENT_VALIDATED',
      'PET_INCIDENT_DISMISSED',
      'PET_WARNING_ISSUED',
      'PET_FINE_CHARGED',
      'PET_STATEMENT_RECEIVED',
      'PET_DOCUMENT_EXPIRING',
      'PET_REMOVED',
    ];

    for (const type of notificationTypes) {
      await queryRunner.query(
        `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS '${type}'`,
      );
      await queryRunner.query(
        `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS '${type}'`,
      );
    }

    // ── Permisos ──────────────────────────────────────────────────────────
    // `permissions.name` es un enum NATIVO: sin estos labels el seed de
    // permisos falla con "invalid input value for enum permissions_name_enum"
    // y el rollback deja al módulo sin ninguno de sus permisos.
    const permissions = [
      'VIEW_PETS',
      'REGISTER_PET',
      'EDIT_PET',
      'APPROVE_PET',
      'REMOVE_PET',
      'VIEW_PET_INCIDENTS',
      'REPORT_PET_INCIDENT',
      'MANAGE_PET_INCIDENTS',
    ];

    for (const value of permissions) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pet_incident_statements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pet_incidents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pets"`);
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "pets_max_per_unit",
        DROP COLUMN IF EXISTS "pets_resident_reporting_enabled",
        DROP COLUMN IF EXISTS "pets_statement_days",
        DROP COLUMN IF EXISTS "pets_expiry_reminder_days"
    `);
    // Los labels de los enums no se revierten: Postgres no permite quitarlos.
  }
}
