import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reserva de zonas comunes.
 *
 * Cuatro tablas que se leen como una resta: `amenity_schedules` dice cuándo
 * abre la zona, `amenity_blackouts` qué se le quita, y `amenity_bookings` qué
 * ya está tomado. `amenities` guarda las reglas del cupo.
 *
 * Los estados y tipos van como varchar y no como enum nativo: el catálogo de
 * tipos de zona cambia con cada complejo nuevo que se suma, y cada cambio en un
 * enum de Postgres exige una migración, mientras que el enum de TypeScript ya
 * valida en el borde de la API.
 *
 * No hay depósito: la unidad no adelanta dinero. La reserva referencia hasta
 * dos cargos, y el segundo casi nunca existe: `fee_charge_id` es la tarifa, y
 * `damage_charge_id` el cobro que se le hace a la unidad solo si al recibir la
 * zona se evidencia un daño. `damage_description` guarda el porqué, que es lo
 * que el residente ve junto al cargo en su estado de cuenta.
 */
export class CreateAmenities1781003700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Zonas comunes ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "amenities" (
        "id"                             uuid          NOT NULL DEFAULT gen_random_uuid(),
        "name"                           varchar(150)  NOT NULL,
        "description"                    text,
        "type"                           varchar(40)   NOT NULL DEFAULT 'OTRO',
        "status"                         varchar(20)   NOT NULL DEFAULT 'ACTIVE',
        "location"                       varchar(200),
        "rules"                          text,
        "image_urls"                     text[]        NOT NULL DEFAULT '{}',
        "booking_mode"                   varchar(10)   NOT NULL DEFAULT 'SLOT',
        "duration_unit"                  varchar(10)   NOT NULL DEFAULT 'HOURS',
        "slot_duration_minutes"          integer       NOT NULL DEFAULT 120,
        "min_duration_minutes"           integer       NOT NULL DEFAULT 60,
        "max_duration_minutes"           integer       NOT NULL DEFAULT 480,
        "capacity"                       integer       NOT NULL DEFAULT 0,
        "max_simultaneous_bookings"      integer       NOT NULL DEFAULT 1,
        "advance_booking_days"           integer       NOT NULL DEFAULT 30,
        "min_advance_days"               integer       NOT NULL DEFAULT 1,
        "cancellation_deadline_days"     integer       NOT NULL DEFAULT 1,
        "max_active_bookings_per_unit"   integer       NOT NULL DEFAULT 2,
        "max_bookings_per_unit_per_month" integer      NOT NULL DEFAULT 0,
        "requires_approval"              boolean       NOT NULL DEFAULT true,
        "block_bookings_on_debt"         boolean       NOT NULL DEFAULT true,
        "fee_type"                       varchar(20)   NOT NULL DEFAULT 'FREE',
        "fee_amount"                     numeric(12,2) NOT NULL DEFAULT 0,
        "complex_id"                     uuid          NOT NULL,
        "created_by_user_id"             uuid,
        "updated_by_user_id"             uuid,
        "created_at"                     timestamptz   NOT NULL DEFAULT now(),
        "updated_at"                     timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"                     timestamptz,
        CONSTRAINT "PK_amenities_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_amenities_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenities_complex_status"
        ON "amenities" ("complex_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenities_complex_type"
        ON "amenities" ("complex_id", "type")
    `);
    // El nombre identifica la zona para el residente; dos "Salón Comunal" en el
    // mismo complejo hacen la reserva ambigua. Parcial, para no chocar con las
    // eliminadas.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_amenities_complex_name"
        ON "amenities" ("complex_id", lower("name")) WHERE "deleted_at" IS NULL
    `);

    // ── Horario semanal ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "amenity_schedules" (
        "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
        "amenity_id"  uuid        NOT NULL,
        "complex_id"  uuid        NOT NULL,
        "day_of_week" integer     NOT NULL,
        "open_time"   time        NOT NULL,
        "close_time"  time        NOT NULL,
        "is_active"   boolean     NOT NULL DEFAULT true,
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_amenity_schedules_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_amenity_schedules_day" CHECK ("day_of_week" BETWEEN 0 AND 6),
        CONSTRAINT "CHK_amenity_schedules_range" CHECK ("close_time" > "open_time"),
        CONSTRAINT "FK_amenity_schedules_amenity"
          FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_schedules_amenity_day"
        ON "amenity_schedules" ("amenity_id", "day_of_week")
    `);

    // ── Bloqueos ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "amenity_blackouts" (
        "id"                 uuid         NOT NULL DEFAULT gen_random_uuid(),
        "amenity_id"         uuid         NOT NULL,
        "complex_id"         uuid         NOT NULL,
        "start_at"           timestamptz  NOT NULL,
        "end_at"             timestamptz  NOT NULL,
        "reason"             varchar(200) NOT NULL,
        "created_by_user_id" uuid,
        "created_at"         timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_amenity_blackouts_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_amenity_blackouts_range" CHECK ("end_at" > "start_at"),
        CONSTRAINT "FK_amenity_blackouts_amenity"
          FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_blackouts_amenity_start"
        ON "amenity_blackouts" ("amenity_id", "start_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_blackouts_complex_start"
        ON "amenity_blackouts" ("complex_id", "start_at")
    `);

    // ── Reservas ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "amenity_bookings" (
        "id"                    uuid          NOT NULL DEFAULT gen_random_uuid(),
        "amenity_id"            uuid          NOT NULL,
        "complex_id"            uuid          NOT NULL,
        "unit_id"               uuid          NOT NULL,
        "resident_id"           uuid,
        "requested_by_user_id"  uuid,
        "requested_by_name"     varchar(180),
        "start_at"              timestamptz   NOT NULL,
        "end_at"                timestamptz   NOT NULL,
        "attendees"             integer       NOT NULL DEFAULT 1,
        "purpose"               varchar(200),
        "notes"                 text,
        "status"                varchar(20)   NOT NULL DEFAULT 'PENDING',
        "approved_by_user_id"   uuid,
        "approved_at"           timestamptz,
        "rejection_reason"      varchar(300),
        "cancelled_by_user_id"  uuid,
        "cancelled_at"          timestamptz,
        "cancellation_reason"   varchar(300),
        "access_code"           varchar(20),
        "check_in_at"           timestamptz,
        "check_out_at"          timestamptz,
        "checked_in_by_user_id" uuid,
        "fee_amount"            numeric(12,2) NOT NULL DEFAULT 0,
        "fee_charge_id"         uuid,
        "damage_amount"         numeric(12,2) NOT NULL DEFAULT 0,
        "damage_description"    text,
        "damage_charge_id"      uuid,
        "damage_charged_at"     timestamptz,
        "damage_charged_by_user_id"    uuid,
        "reminder_sent_at"      timestamptz,
        "created_at"            timestamptz   NOT NULL DEFAULT now(),
        "updated_at"            timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"            timestamptz,
        CONSTRAINT "PK_amenity_bookings_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_amenity_bookings_range" CHECK ("end_at" > "start_at"),
        CONSTRAINT "FK_amenity_bookings_amenity"
          FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_amenity_bookings_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_amenity_bookings_unit"
          FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_bookings_complex_status"
        ON "amenity_bookings" ("complex_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_bookings_complex_start"
        ON "amenity_bookings" ("complex_id", "start_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_bookings_unit_status"
        ON "amenity_bookings" ("unit_id", "status")
    `);
    // La consulta caliente del motor de disponibilidad: qué se cruza con una
    // ventana en una zona.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_bookings_amenity_window"
        ON "amenity_bookings" ("amenity_id", "start_at", "end_at")
    `);
    // El código lo teclea la portería; debe resolverse por índice y no repetirse
    // entre reservas vivas.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_amenity_bookings_access_code"
        ON "amenity_bookings" ("access_code")
        WHERE "access_code" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // ── Tipos de notificación ────────────────────────────────────────────────
    // notifications.type es un enum nativo: sin estos labels los avisos de
    // reserva fallarían en el INSERT, y como notify() es fire-and-forget el
    // error se tragaría en silencio.
    const notificationTypes = [
      'AMENITY_BOOKING_REQUESTED',
      'AMENITY_BOOKING_APPROVED',
      'AMENITY_BOOKING_REJECTED',
      'AMENITY_BOOKING_CANCELLED',
      'AMENITY_BOOKING_NO_SHOW',
      'AMENITY_DAMAGE_CHARGED',
    ];

    for (const value of notificationTypes) {
      await queryRunner.query(
        `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
      // notification_batches comparte el catálogo de tipos; dejarlo atrás
      // convierte cualquier envío masivo futuro de estos tipos en un error.
      await queryRunner.query(
        `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // ── Permisos ─────────────────────────────────────────────────────────────
    // permissions.name también es enum nativo: sin estos labels el seed de
    // permisos falla entero y ningún rol puede recibir los permisos del módulo.
    const permissionNames = [
      'VIEW_AMENITIES',
      'MANAGE_AMENITIES',
      'VIEW_AMENITY_BOOKINGS',
      'CREATE_AMENITY_BOOKING',
      'APPROVE_AMENITY_BOOKING',
      'CHECK_IN_AMENITY_BOOKING',
    ];

    for (const value of permissionNames) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Los labels del enum no se revierten: Postgres no permite quitar valores de
    // un enum, y dejarlos de más es inocuo.
    await queryRunner.query(`DROP TABLE IF EXISTS "amenity_bookings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "amenity_blackouts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "amenity_schedules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "amenities"`);
  }
}
