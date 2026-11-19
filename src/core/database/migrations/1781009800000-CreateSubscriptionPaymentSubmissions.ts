import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renovación con soporte de pago.
 *
 * - `subscription_payment_submissions`: el conjunto declara lo que pagó con el
 *   QR y adjunta el comprobante (llave de R2, sin URL pública). Queda PENDING
 *   hasta que el SUPER_ADMIN lo aprueba (registra el periodo) o lo rechaza.
 *   El índice único parcial deja un solo soporte pendiente por conjunto.
 * - `subscription_payment_settings`: QR e instrucciones de pago, una fila.
 * - Tipos de notificación nuevos, agregados sin usarse en esta transacción.
 */
export class CreateSubscriptionPaymentSubmissions1781009800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_payment_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "plan" varchar(20) NOT NULL,
        "cycle" varchar(10) NOT NULL,
        "amount_due" numeric(18,2) NOT NULL,
        "amount_paid" numeric(18,2) NOT NULL,
        "paid_at" timestamptz NOT NULL,
        "reference" varchar(120),
        "receipt_key" varchar(500) NOT NULL,
        "receipt_name" varchar(255) NOT NULL,
        "receipt_mime_type" varchar(100) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'PENDING',
        "review_note" text,
        "reviewed_by_user_id" uuid,
        "reviewed_at" timestamptz,
        "period_id" uuid,
        "submitted_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_payment_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_payment_submissions_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_payment_submissions_complex"
        ON "subscription_payment_submissions" ("complex_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_payment_submissions_status"
        ON "subscription_payment_submissions" ("status", "created_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscription_payment_submissions_pending"
        ON "subscription_payment_submissions" ("complex_id")
        WHERE "status" = 'PENDING'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_payment_settings" (
        "id" int NOT NULL,
        "qr_image_url" varchar(500),
        "instructions" text,
        "updated_by_user_id" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_payment_settings" PRIMARY KEY ("id")
      )
    `);

    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const rows = (await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      )) as { exists: boolean }[];
      if (!rows[0]?.exists) continue;

      for (const value of [
        'SUBSCRIPTION_PAYMENT_SUBMITTED',
        'SUBSCRIPTION_PAYMENT_REJECTED',
      ]) {
        await queryRunner.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}'`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Los valores del enum de notificaciones no se pueden quitar en Postgres.
    await queryRunner.query(
      `DROP TABLE IF EXISTS "subscription_payment_settings"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "subscription_payment_submissions"`,
    );
  }
}
