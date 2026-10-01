import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suscripciones de los complejos: mensual o anual, con avisos de vencimiento,
 * 5 días de gracia y suspensión del panel administrativo.
 *
 * - `subscription_plan_prices`: precio por plan, editable por el SUPER_ADMIN.
 * - `subscription_periods`: historial de periodos (inicial, prueba, pagado).
 * - `subscription_reminders`: avisos ya enviados; el índice único evita
 *   duplicados si el cron corre dos veces.
 * - `residential_complexes.subscription_ends_at`: vencimiento vigente.
 *
 * Los complejos que ya operan (ACTIVE y PENDING_SETUP) reciben un periodo
 * INITIAL de 30 días desde el despliegue: nadie queda suspendido de golpe.
 * Los que esperan revisión o están suspendidos quedan sin suscripción.
 */
export class CreateSubscriptions1781007900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "subscription_period_kind" AS ENUM ('INITIAL', 'TRIAL', 'PAID');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "subscription_billing_cycle" AS ENUM ('MONTHLY', 'ANNUAL');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_plan_prices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "plan" varchar(20) NOT NULL,
        "monthly_price" numeric(18,2) NOT NULL,
        "annual_price" numeric(18,2),
        "updated_by_id" uuid,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_plan_prices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscription_plan_prices_plan" UNIQUE ("plan")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_periods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "kind" "subscription_period_kind" NOT NULL,
        "plan" varchar(20) NOT NULL,
        "cycle" "subscription_billing_cycle",
        "starts_at" TIMESTAMPTZ NOT NULL,
        "ends_at" TIMESTAMPTZ NOT NULL,
        "amount" numeric(18,2),
        "paid_at" TIMESTAMPTZ,
        "payment_reference" varchar(120),
        "notes" text,
        "created_by_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_periods" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_periods_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscription_periods_complex_ends" ON "subscription_periods" ("complex_id", "ends_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_reminders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "ends_at" TIMESTAMPTZ NOT NULL,
        "milestone" varchar(20) NOT NULL,
        "sent_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_reminders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_reminders_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscription_reminders_milestone" ON "subscription_reminders" ("complex_id", "ends_at", "milestone")`,
    );

    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "subscription_ends_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_residential_complexes_subscription_ends_at" ON "residential_complexes" ("subscription_ends_at")`,
    );

    // Periodo inicial para los complejos que ya operan. Solo a quien todavía no
    // tiene vencimiento: si la migración se repite no regala otros 30 días.
    await queryRunner.query(`
      WITH started AS (
        UPDATE "residential_complexes"
           SET "subscription_ends_at" = now() + interval '30 days'
         WHERE "deleted_at" IS NULL
           AND "subscription_ends_at" IS NULL
           AND "status" IN ('ACTIVE', 'PENDING_SETUP')
        RETURNING "id", "plan", "subscription_ends_at"
      )
      INSERT INTO "subscription_periods"
        ("complex_id", "kind", "plan", "starts_at", "ends_at", "notes")
      SELECT "id", 'INITIAL', "plan"::text, now(), "subscription_ends_at",
             'Periodo inicial al lanzar las suscripciones'
        FROM started
    `);

    // Tipos de notificación nuevos. Se agregan sin usarse en esta transacción.
    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );
    if (exists) {
      for (const type of [
        'SUBSCRIPTION_EXPIRING',
        'SUBSCRIPTION_EXPIRED',
        'SUBSCRIPTION_SUSPENDED',
        'SUBSCRIPTION_RENEWED',
      ]) {
        await queryRunner.query(
          `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS '${type}'`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Los valores del enum de notificaciones no se pueden quitar en Postgres.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_residential_complexes_subscription_ends_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "subscription_ends_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_reminders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_periods"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_plan_prices"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_billing_cycle"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_period_kind"`);
  }
}
