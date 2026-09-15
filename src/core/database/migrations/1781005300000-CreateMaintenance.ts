import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mantenimiento de zonas comunes con geolocalización.
 *
 * Seis tablas: el ticket (`maintenance_tickets`), su bitácora
 * (`maintenance_ticket_events`), los puntos QR/NFC del conjunto
 * (`maintenance_location_tags`), los proveedores externos
 * (`maintenance_vendors`), la política de plazos
 * (`maintenance_sla_configs`) y las adhesiones de los vecinos
 * (`maintenance_endorsements`).
 *
 * Tres decisiones quedan garantizadas por la base y no por el servicio:
 *
 *   · `UQ_maintenance_tickets_complex_consecutive` — dos vecinos reportando en
 *     el mismo segundo no pueden llevarse el mismo número, que es el que se
 *     cita en la cotización del proveedor.
 *   · `UQ_maintenance_endorsements_ticket_user` — una adhesión por persona; sin
 *     esto el contador que prioriza el tablero se infla solo.
 *   · `UQ_maintenance_location_tags_complex_code` — el código está impreso en
 *     un sticker pegado en la pared: dos puntos con el mismo código dejarían el
 *     escaneo apuntando a cualquiera de los dos.
 *
 * Corre fuera de transacción porque agrega valores a los enums nativos de
 * notificaciones y de permisos, igual que las migraciones de PQRF, votaciones y
 * mascotas.
 */
export class CreateMaintenance1781005300000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Configuración del módulo en el complejo ──────────────────────────
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "maintenance_resident_reporting_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "maintenance_auto_close_days"            int     NOT NULL DEFAULT 7,
        ADD COLUMN IF NOT EXISTS "maintenance_reopen_window_days"         int     NOT NULL DEFAULT 7,
        ADD COLUMN IF NOT EXISTS "maintenance_duplicate_window_hours"     int     NOT NULL DEFAULT 48,
        ADD COLUMN IF NOT EXISTS "maintenance_gps_accuracy_meters"        int     NOT NULL DEFAULT 100
    `);

    // ── Proveedores externos ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maintenance_vendors" (
        "id"                 uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "name"               varchar(150) NOT NULL,
        "legal_id"           varchar(30),
        "contact_name"       varchar(150),
        "phone"              varchar(30),
        "email"              varchar(150),
        "specialties"        text[]       NOT NULL DEFAULT '{}',
        "notes"              text,
        "is_active"          boolean      NOT NULL DEFAULT true,
        "complex_id"         uuid         NOT NULL,
        "created_by_user_id" uuid,
        "created_at"         timestamptz  NOT NULL DEFAULT now(),
        "updated_at"         timestamptz  NOT NULL DEFAULT now(),
        "deleted_at"         timestamptz,
        CONSTRAINT "PK_maintenance_vendors_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_maintenance_vendors_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_vendors_complex_active"
        ON "maintenance_vendors" ("complex_id", "is_active")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_maintenance_vendors_complex_legal_id"
        ON "maintenance_vendors" ("complex_id", "legal_id")
        WHERE "legal_id" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // ── Puntos señalizados (QR / NFC) ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maintenance_location_tags" (
        "id"                 uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "code"               varchar(40)   NOT NULL,
        "name"               varchar(150)  NOT NULL,
        "description"        text,
        "kind"               varchar(10)   NOT NULL DEFAULT 'QR',
        "building_id"        uuid,
        "floor"              smallint,
        "amenity_id"         uuid,
        "lat"                decimal(10,8),
        "lng"                decimal(11,8),
        "default_category"   varchar(30),
        "is_active"          boolean       NOT NULL DEFAULT true,
        "complex_id"         uuid          NOT NULL,
        "created_by_user_id" uuid,
        "created_at"         timestamptz   NOT NULL DEFAULT now(),
        "updated_at"         timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"         timestamptz,
        CONSTRAINT "PK_maintenance_location_tags_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_maintenance_location_tags_complex_code" UNIQUE ("complex_id", "code"),
        CONSTRAINT "FK_maintenance_location_tags_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_location_tags_building"
          FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_maintenance_location_tags_amenity"
          FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_location_tags_complex_active"
        ON "maintenance_location_tags" ("complex_id", "is_active")
    `);

    // ── Política de plazos ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maintenance_sla_configs" (
        "id"               uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "category"         varchar(30) NOT NULL,
        "priority"         varchar(20) NOT NULL,
        "response_hours"   int         NOT NULL,
        "resolution_hours" int         NOT NULL,
        "complex_id"       uuid        NOT NULL,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_maintenance_sla_configs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_maintenance_sla_configs_complex_category_priority"
          UNIQUE ("complex_id", "category", "priority"),
        CONSTRAINT "FK_maintenance_sla_configs_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);

    // ── Ticket ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maintenance_tickets" (
        "id"                     uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "code"                   varchar(20)   NOT NULL,
        "consecutive"            int           NOT NULL,
        "title"                  varchar(160)  NOT NULL,
        "description"            text          NOT NULL,
        "category"               varchar(30)   NOT NULL,
        "priority"               varchar(20)   NOT NULL DEFAULT 'MEDIUM',
        "visibility"             varchar(10)   NOT NULL DEFAULT 'PUBLIC',
        "photo_urls"             text[]        NOT NULL DEFAULT '{}',
        "photo_hashes"           text[]        NOT NULL DEFAULT '{}',
        "video_url"              text,
        "video_hash"             varchar(64),
        "occurred_at"            timestamptz   NOT NULL,
        "location_type"          varchar(20)   NOT NULL DEFAULT 'TREE',
        "location_text"          varchar(200),
        "lat"                    decimal(10,8),
        "lng"                    decimal(11,8),
        "gps_accuracy_meters"    int,
        "building_id"            uuid,
        "floor"                  smallint,
        "amenity_id"             uuid,
        "location_tag_id"        uuid,
        "reported_by_user_id"    uuid,
        "reported_by_role"       varchar(50),
        "reported_by_name"       varchar(200),
        "reported_by_unit_id"    uuid,
        "endorsement_count"      int           NOT NULL DEFAULT 0,
        "status"                 varchar(20)   NOT NULL DEFAULT 'NEW',
        "triaged_by_user_id"     uuid,
        "triaged_at"             timestamptz,
        "assignee_type"          varchar(20),
        "assigned_user_id"       uuid,
        "vendor_id"              uuid,
        "assigned_by_user_id"    uuid,
        "assigned_at"            timestamptz,
        "scheduled_for"          timestamptz,
        "sla_hours"              int,
        "sla_due_at"             timestamptz,
        "sla_breached_at"        timestamptz,
        "started_at"             timestamptz,
        "on_hold_reason"         text,
        "resolution_notes"       text,
        "closure_photo_urls"     text[]        NOT NULL DEFAULT '{}',
        "closure_photo_hashes"   text[]        NOT NULL DEFAULT '{}',
        "resolved_by_user_id"    uuid,
        "resolved_at"            timestamptz,
        "actual_cost"            numeric(14,2),
        "closed_at"              timestamptz,
        "closed_by_user_id"      uuid,
        "rejection_reason"       text,
        "duplicate_of_ticket_id" uuid,
        "rating"                 smallint,
        "rating_comment"         text,
        "rated_at"               timestamptz,
        "reopen_count"           int           NOT NULL DEFAULT 0,
        "last_reopened_at"       timestamptz,
        "complex_id"             uuid          NOT NULL,
        "created_at"             timestamptz   NOT NULL DEFAULT now(),
        "updated_at"             timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"             timestamptz,
        CONSTRAINT "PK_maintenance_tickets_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_maintenance_tickets_complex_consecutive" UNIQUE ("complex_id", "consecutive"),
        CONSTRAINT "CHK_maintenance_tickets_rating" CHECK ("rating" IS NULL OR ("rating" BETWEEN 1 AND 5)),
        CONSTRAINT "FK_maintenance_tickets_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_tickets_building"
          FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_maintenance_tickets_amenity"
          FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_maintenance_tickets_location_tag"
          FOREIGN KEY ("location_tag_id") REFERENCES "maintenance_location_tags"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_maintenance_tickets_vendor"
          FOREIGN KEY ("vendor_id") REFERENCES "maintenance_vendors"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_maintenance_tickets_assigned_user"
          FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_maintenance_tickets_reported_unit"
          FOREIGN KEY ("reported_by_unit_id") REFERENCES "units"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_tickets_complex_status"
        ON "maintenance_tickets" ("complex_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_tickets_complex_category_status"
        ON "maintenance_tickets" ("complex_id", "category", "status")
    `);
    // El cron de vencimientos barre por plazo: sin este índice recorre la tabla
    // entera cada hora.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_tickets_complex_sla_due"
        ON "maintenance_tickets" ("complex_id", "sla_due_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_tickets_assigned_user"
        ON "maintenance_tickets" ("assigned_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_tickets_vendor"
        ON "maintenance_tickets" ("vendor_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_tickets_location_tag"
        ON "maintenance_tickets" ("location_tag_id")
    `);

    // ── Bitácora ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maintenance_ticket_events" (
        "id"             uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "ticket_id"      uuid         NOT NULL,
        "type"           varchar(30)  NOT NULL,
        "message"        text,
        "from_status"    varchar(20),
        "to_status"      varchar(20),
        "image_urls"     text[]       NOT NULL DEFAULT '{}',
        "image_hashes"   text[]       NOT NULL DEFAULT '{}',
        "is_internal"    boolean      NOT NULL DEFAULT false,
        "author_user_id" uuid,
        "author_role"    varchar(50),
        "author_name"    varchar(200),
        "complex_id"     uuid         NOT NULL,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_maintenance_ticket_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_maintenance_ticket_events_ticket"
          FOREIGN KEY ("ticket_id") REFERENCES "maintenance_tickets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_ticket_events_author"
          FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_ticket_events_ticket_created"
        ON "maintenance_ticket_events" ("ticket_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maintenance_ticket_events_complex_type"
        ON "maintenance_ticket_events" ("complex_id", "type")
    `);

    // ── Adhesiones ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maintenance_endorsements" (
        "id"         uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "ticket_id"  uuid        NOT NULL,
        "user_id"    uuid        NOT NULL,
        "unit_id"    uuid,
        "comment"    text,
        "complex_id" uuid        NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_maintenance_endorsements_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_maintenance_endorsements_ticket_user" UNIQUE ("ticket_id", "user_id"),
        CONSTRAINT "FK_maintenance_endorsements_ticket"
          FOREIGN KEY ("ticket_id") REFERENCES "maintenance_tickets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_endorsements_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // ── Tipos de notificación ─────────────────────────────────────────────
    // Sin estos labels los avisos se pierden en el INSERT, que va
    // fire-and-forget: nadie se enteraría de que su reporte se atendió.
    const notificationTypes = [
      'MAINTENANCE_TICKET_REPORTED',
      'MAINTENANCE_TICKET_ASSIGNED',
      'MAINTENANCE_TICKET_UPDATED',
      'MAINTENANCE_TICKET_RESOLVED',
      'MAINTENANCE_TICKET_REJECTED',
      'MAINTENANCE_TICKET_REOPENED',
      'MAINTENANCE_SLA_BREACHED',
      'MAINTENANCE_RATING_REQUESTED',
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
    // `permissions.name` es un enum NATIVO: sin estos labels el seed falla con
    // "invalid input value for enum permissions_name_enum".
    const permissions = [
      'VIEW_MAINTENANCE_TICKETS',
      'REPORT_MAINTENANCE_TICKET',
      'MANAGE_MAINTENANCE_TICKETS',
      'CLOSE_MAINTENANCE_TICKET',
      'MANAGE_MAINTENANCE_LOCATIONS',
      'MANAGE_MAINTENANCE_VENDORS',
      'MANAGE_MAINTENANCE_SLA',
    ];

    for (const value of permissions) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_endorsements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_ticket_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_tickets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_sla_configs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_location_tags"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_vendors"`);
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "maintenance_resident_reporting_enabled",
        DROP COLUMN IF EXISTS "maintenance_auto_close_days",
        DROP COLUMN IF EXISTS "maintenance_reopen_window_days",
        DROP COLUMN IF EXISTS "maintenance_duplicate_window_hours",
        DROP COLUMN IF EXISTS "maintenance_gps_accuracy_meters"
    `);
    // Los labels de los enums no se revierten: Postgres no permite quitarlos.
  }
}
