import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Integra la prelación de pagos y la idempotencia del cron de causación.
 *
 *  - Crea el enum prelacion_concept_enum.
 *  - Agrega "prelacionConcept" a fee_charges y fee_configs (default 'ORDINARY').
 *  - Agrega "lastBilledPeriod" a recurring_charges (idempotencia de causación).
 */
export class AddPrelacionAndRecurringBilling1781000100000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "prelacion_concept_enum" AS ENUM
          ('INTEREST_MORA','FINE','EXTRAORDINARY','ORDINARY');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "fee_charges"
      ADD COLUMN IF NOT EXISTS "prelacionConcept" "prelacion_concept_enum" NOT NULL DEFAULT 'ORDINARY'
    `);
    await queryRunner.query(`
      ALTER TABLE "fee_configs"
      ADD COLUMN IF NOT EXISTS "prelacionConcept" "prelacion_concept_enum" NOT NULL DEFAULT 'ORDINARY'
    `);
    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "lastBilledPeriod" varchar(7)
    `);

    // Índice para acelerar el ordenamiento por prelación al imputar pagos
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fee_charges_prelacion"
      ON "fee_charges" ("complexId","unitId","prelacionConcept","period")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fee_charges_prelacion"`);
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "lastBilledPeriod"`);
    await queryRunner.query(`ALTER TABLE "fee_configs"  DROP COLUMN IF EXISTS "prelacionConcept"`);
    await queryRunner.query(`ALTER TABLE "fee_charges"  DROP COLUMN IF EXISTS "prelacionConcept"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "prelacion_concept_enum"`);
  }
}
