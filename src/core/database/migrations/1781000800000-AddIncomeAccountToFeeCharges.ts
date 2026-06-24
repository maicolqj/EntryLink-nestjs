import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cuenta de ingreso heredada en el cargo (fee_charges.incomeAccountId).
 * Se hereda del RecurringCharge al causar y se usa para emitir la nota crédito
 * del descuento por pronto pago. Idempotente.
 */
export class AddIncomeAccountToFeeCharges1781000800000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fee_charges"
      ADD COLUMN IF NOT EXISTS "incomeAccountId" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_charges" DROP COLUMN IF EXISTS "incomeAccountId"`);
  }
}
