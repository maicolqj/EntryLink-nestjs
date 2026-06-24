import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Segmentación y reparto diferencial en recurring_charges.
 *
 *  - "distribution": COEFFICIENT | EQUAL | FIXED_PER_UNIT. Cómo se reparte el
 *    monto entre las unidades elegidas. Backfill desde el flag legacy
 *    prorateByCoefficient (true→COEFFICIENT, false→FIXED_PER_UNIT) para preservar
 *    el comportamiento existente.
 *  - "targetRules" (jsonb): a quién se cobra (excludeFloor1, floorMin/Max,
 *    buildingIds, unitTypes). Ej: ascensor solo pisos ≥ 2.
 *  - "targetUnitIds" (uuid[]): selección manual de unidades (prioridad).
 *
 * Idempotente.
 */
export class AddRecurringChargeSegmentation1781000600000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "recurring_charges_distribution_enum" AS ENUM ('COEFFICIENT','EQUAL','FIXED_PER_UNIT');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "distribution" "recurring_charges_distribution_enum"
      NOT NULL DEFAULT 'FIXED_PER_UNIT'
    `);

    // Preservar comportamiento previo: los que prorrateaban quedan en COEFFICIENT.
    await queryRunner.query(`
      UPDATE "recurring_charges"
      SET "distribution" = 'COEFFICIENT'
      WHERE "prorateByCoefficient" = true
    `);

    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "targetRules" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "targetUnitIds" uuid[]
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "targetUnitIds"`);
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "targetRules"`);
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "distribution"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "recurring_charges_distribution_enum"`);
  }
}
