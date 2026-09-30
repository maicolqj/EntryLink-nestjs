import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Parqueaderos y bodegas propios de cada unidad.
 *
 * La unidad ya guardaba cuántos tiene; esta tabla guarda cuáles son, para que
 * el residente los vea en "Mi unidad". Un mismo código (por tipo) no puede
 * quedar en dos unidades del conjunto.
 */
export class CreateUnitAssets1781007400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "unit_asset_type" AS ENUM ('PARKING', 'STORAGE');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "unit_assets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" "unit_asset_type" NOT NULL,
        "code" varchar(50) NOT NULL,
        "location" varchar(150),
        "unit_id" uuid NOT NULL,
        "complex_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_unit_assets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_unit_assets_unit" FOREIGN KEY ("unit_id")
          REFERENCES "units"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_unit_assets_unit" ON "unit_assets" ("unit_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_unit_assets_complex_type_code"
        ON "unit_assets" ("complex_id", "type", "code")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "unit_assets"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "unit_asset_type"`);
  }
}
