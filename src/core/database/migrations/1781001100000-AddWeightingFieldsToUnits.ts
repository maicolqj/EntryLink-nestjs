import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega a "units" los atributos que alimentan la ponderación del coeficiente:
 *  - hasElevator: si la unidad usa/paga ascensor.
 *  - houseFloors: número de pisos de la casa (solo HOUSE).
 *
 * Idempotente (IF NOT EXISTS) por si en dev se corrió `synchronize`.
 */
export class AddWeightingFieldsToUnits1781001100000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "units"
      ADD COLUMN IF NOT EXISTS "hasElevator" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "units"
      ADD COLUMN IF NOT EXISTS "houseFloors" smallint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "units" DROP COLUMN IF EXISTS "houseFloors"`);
    await queryRunner.query(`ALTER TABLE "units" DROP COLUMN IF EXISTS "hasElevator"`);
  }
}
