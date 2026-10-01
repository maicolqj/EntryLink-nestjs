import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cobro personalizado por conjunto: no paga lo mismo una copropiedad de 140
 * unidades que una de 800.
 *
 * - `residential_complexes`: modalidad (PER_UNIT | PLAN | FIXED), valor (por
 *   unidad o fijo mensual, antes de impuestos) y ciclo de cobro.
 * - `subscription_taxes`: impuestos que se suman al subtotal; arranca con
 *   IVA 19 %, editable por el SUPER_ADMIN.
 * - `subscription_periods`: desglose de cada cobro (modalidad, unidades, valor
 *   por unidad, subtotal, impuestos con la tarifa vigente al pagar).
 */
export class SubscriptionPricingAndTaxes1781008000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "subscription_pricing_mode" varchar(20) NOT NULL DEFAULT 'PLAN',
        ADD COLUMN IF NOT EXISTS "subscription_price" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "subscription_cycle" varchar(10) NOT NULL DEFAULT 'MONTHLY'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_taxes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(60) NOT NULL,
        "rate" numeric(5,2) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" int NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_taxes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "subscription_taxes" ("name", "rate", "is_active", "sort_order")
      SELECT 'IVA', 19, true, 0
       WHERE NOT EXISTS (SELECT 1 FROM "subscription_taxes")
    `);

    await queryRunner.query(`
      ALTER TABLE "subscription_periods"
        ADD COLUMN IF NOT EXISTS "pricing_mode" varchar(20),
        ADD COLUMN IF NOT EXISTS "unit_count" int,
        ADD COLUMN IF NOT EXISTS "unit_price" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "subtotal" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "tax_amount" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "taxes" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription_periods"
        DROP COLUMN IF EXISTS "taxes",
        DROP COLUMN IF EXISTS "tax_amount",
        DROP COLUMN IF EXISTS "subtotal",
        DROP COLUMN IF EXISTS "unit_price",
        DROP COLUMN IF EXISTS "unit_count",
        DROP COLUMN IF EXISTS "pricing_mode"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_taxes"`);
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "subscription_cycle",
        DROP COLUMN IF EXISTS "subscription_price",
        DROP COLUMN IF EXISTS "subscription_pricing_mode"
    `);
  }
}
