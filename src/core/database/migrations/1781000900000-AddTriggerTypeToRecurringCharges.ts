import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * triggerType en recurring_charges: MANUAL (segmentada) | VEHICLE (un cargo por
 * cada vehículo activo, ej. parqueadero). Default MANUAL para no alterar los
 * cargos existentes. Idempotente.
 */
export class AddTriggerTypeToRecurringCharges1781000900000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "recurring_charges_triggertype_enum" AS ENUM ('MANUAL','VEHICLE');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "triggerType" "recurring_charges_triggertype_enum"
      NOT NULL DEFAULT 'MANUAL'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "triggerType"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "recurring_charges_triggertype_enum"`);
  }
}
