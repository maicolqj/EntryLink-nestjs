import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Impuestos globales y locales, retenciones y corrección de pagos.
 *
 * - `subscription_taxes.kind`: CHARGE (se suma, como el IVA) o WITHHOLDING
 *   (la retiene el conjunto, como la retención en la fuente). Los existentes
 *   quedan CHARGE, que es como se venían aplicando.
 * - `subscription_taxes.complex_id`: vacío = global (todos los conjuntos);
 *   con valor = local de ese conjunto (p. ej. su retención del 2 %, 4 % o 6 %).
 * - `subscription_periods.withholding_amount`: lo retenido en cada pago.
 * - `subscription_periods.updated_by_id` / `payment_updated_at`: quién y
 *   cuándo corrigió el pago por última vez.
 */
export class SubscriptionLocalTaxesAndPaymentEdits1781008100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription_taxes"
        ADD COLUMN IF NOT EXISTS "kind" varchar(20) NOT NULL DEFAULT 'CHARGE',
        ADD COLUMN IF NOT EXISTS "complex_id" uuid
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "subscription_taxes"
          ADD CONSTRAINT "FK_subscription_taxes_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id")
          ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_taxes_complex"
        ON "subscription_taxes" ("complex_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "subscription_periods"
        ADD COLUMN IF NOT EXISTS "withholding_amount" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "updated_by_id" uuid,
        ADD COLUMN IF NOT EXISTS "payment_updated_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription_periods"
        DROP COLUMN IF EXISTS "payment_updated_at",
        DROP COLUMN IF EXISTS "updated_by_id",
        DROP COLUMN IF EXISTS "withholding_amount"
    `);
    // Los locales no tienen sentido sin su conjunto: se borran antes de
    // quitar la columna, o quedarían aplicando a todos.
    await queryRunner.query(
      `DELETE FROM "subscription_taxes" WHERE "complex_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_taxes_complex"`,
    );
    await queryRunner.query(`
      ALTER TABLE "subscription_taxes"
        DROP CONSTRAINT IF EXISTS "FK_subscription_taxes_complex",
        DROP COLUMN IF EXISTS "complex_id",
        DROP COLUMN IF EXISTS "kind"
    `);
  }
}
