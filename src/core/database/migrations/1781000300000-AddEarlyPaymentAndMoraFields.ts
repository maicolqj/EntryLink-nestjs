import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columnas de pronto pago y trazabilidad de mora.
 *
 *  - fee_configs.earlyPaymentAmount / earlyPaymentDueDayOfMonth: descuento de
 *    pronto pago y su día de vencimiento.
 *  - fee_charges.normalAmount / earlyPaymentDueDate: monto normal antes del
 *    descuento y fecha límite de pronto pago por cargo.
 *  - fee_charges.sourceChargeId: enlaza la fila de mora con el cargo padre,
 *    para calcular moraAmount en lectura.
 *
 * Identificadores camelCase citados (sin naming strategy). Idempotente:
 * algunas columnas pueden existir de un `synchronize` previo en dev.
 */
export class AddEarlyPaymentAndMoraFields1781000300000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fee_configs"
      ADD COLUMN IF NOT EXISTS "earlyPaymentAmount" numeric(12,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "fee_configs"
      ADD COLUMN IF NOT EXISTS "earlyPaymentDueDayOfMonth" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "fee_charges"
      ADD COLUMN IF NOT EXISTS "normalAmount" numeric(12,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "fee_charges"
      ADD COLUMN IF NOT EXISTS "earlyPaymentDueDate" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "fee_charges"
      ADD COLUMN IF NOT EXISTS "sourceChargeId" uuid
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fee_charges_source"
      ON "fee_charges" ("sourceChargeId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fee_charges_source"`);
    await queryRunner.query(`ALTER TABLE "fee_charges" DROP COLUMN IF EXISTS "sourceChargeId"`);
    await queryRunner.query(`ALTER TABLE "fee_charges" DROP COLUMN IF EXISTS "earlyPaymentDueDate"`);
    await queryRunner.query(`ALTER TABLE "fee_charges" DROP COLUMN IF EXISTS "normalAmount"`);
    await queryRunner.query(`ALTER TABLE "fee_configs" DROP COLUMN IF EXISTS "earlyPaymentDueDayOfMonth"`);
    await queryRunner.query(`ALTER TABLE "fee_configs" DROP COLUMN IF EXISTS "earlyPaymentAmount"`);
  }
}
