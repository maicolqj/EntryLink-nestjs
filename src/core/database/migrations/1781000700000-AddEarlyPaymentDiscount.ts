import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Descuento por pronto pago (% + día límite del mes).
 *
 *  - complex_finance_configs: default global del complejo
 *    (earlyDiscountPct, earlyDiscountDay).
 *  - recurring_charges: override opcional por concepto (null = usar el global).
 *
 * Al causar, el FeeCharge nace con amount descontado + normalAmount (pleno) +
 * earlyPaymentDueDate (día N del mes de vencimiento); el cron diario restaura el
 * monto si no se paga a tiempo. Idempotente.
 */
export class AddEarlyPaymentDiscount1781000700000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "complex_finance_configs"
      ADD COLUMN IF NOT EXISTS "earlyDiscountPct" numeric(5,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "complex_finance_configs"
      ADD COLUMN IF NOT EXISTS "earlyDiscountDay" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "earlyDiscountPct" numeric(5,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "earlyDiscountDay" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "earlyDiscountDay"`);
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "earlyDiscountPct"`);
    await queryRunner.query(`ALTER TABLE "complex_finance_configs" DROP COLUMN IF EXISTS "earlyDiscountDay"`);
    await queryRunner.query(`ALTER TABLE "complex_finance_configs" DROP COLUMN IF EXISTS "earlyDiscountPct"`);
  }
}
