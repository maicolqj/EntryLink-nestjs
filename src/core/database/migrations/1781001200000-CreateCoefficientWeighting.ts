import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea "coefficient_weightings": tabla de pesos para derivar el coeficiente
 * de copropiedad por características. Una fila por complejo (complexId único).
 *
 * Columnas en camelCase (sin naming strategy global, igual que
 * complex_finance_configs). Idempotente.
 */
export class CreateCoefficientWeighting1781001200000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coefficient_weightings" (
        "id"               uuid           NOT NULL DEFAULT gen_random_uuid(),
        "complexId"        uuid           NOT NULL,
        "base"             varchar(8)     NOT NULL DEFAULT 'AREA',
        "typeMultipliers"  jsonb          NOT NULL DEFAULT '{}',
        "perBedroom"       numeric(12,4)  NOT NULL DEFAULT 0,
        "perBathroom"      numeric(12,4)  NOT NULL DEFAULT 0,
        "perParking"       numeric(12,4)  NOT NULL DEFAULT 0,
        "perStorage"       numeric(12,4)  NOT NULL DEFAULT 0,
        "elevatorPoints"   numeric(12,4)  NOT NULL DEFAULT 0,
        "houseFloorPoints" numeric(12,4)  NOT NULL DEFAULT 0,
        "createdAt"        timestamptz    NOT NULL DEFAULT now(),
        "updatedAt"        timestamptz    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coefficient_weightings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coefficient_weightings_complex"
      ON "coefficient_weightings" ("complexId")
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "coefficient_weightings"
        ADD CONSTRAINT "FK_coefficient_weightings_complex"
        FOREIGN KEY ("complexId")
        REFERENCES "residential_complexes"("id")
        ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coefficient_weightings"`);
  }
}
