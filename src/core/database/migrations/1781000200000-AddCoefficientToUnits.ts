import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Coeficiente de copropiedad (Ley 675) en las unidades, para prorratear cobros
 * recurrentes a nivel de complejo. Fracción con suma teórica = 1 (100%).
 */
export class AddCoefficientToUnits1781000200000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "units"
      ADD COLUMN IF NOT EXISTS "coefficient" numeric(9,6)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "units" DROP COLUMN IF EXISTS "coefficient"`);
  }
}
