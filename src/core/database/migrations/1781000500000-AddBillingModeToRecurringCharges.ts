import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega "billingMode" a recurring_charges (ADVANCE | ARREARS).
 *
 * Default ARREARS (mes vencido): al causar un período, el cargo vence el
 * `billingDay` del mes SIGUIENTE, evitando que nazca vencido / con mora.
 *
 * Idempotente. El nombre del enum sigue la convención de TypeORM
 * (`recurring_charges_billingmode_enum`) por si en dev se corre `synchronize`.
 */
export class AddBillingModeToRecurringCharges1781000500000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "recurring_charges_billingmode_enum" AS ENUM ('ADVANCE','ARREARS');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "billingMode" "recurring_charges_billingmode_enum"
      NOT NULL DEFAULT 'ARREARS'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "billingMode"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "recurring_charges_billingmode_enum"`);
  }
}
