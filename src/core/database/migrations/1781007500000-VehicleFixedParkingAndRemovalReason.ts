import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Parqueadero fijo y motivo de baja del vehículo.
 *
 * - `fixed_parking_asset_id`: parqueadero propio de la unidad asignado al
 *   vehículo. Con él queda fuera del sorteo de la rotación. Si el parqueadero
 *   se borra, el vehículo vuelve a la rotación (SET NULL).
 * - `removal_reason`: por qué se dio de baja (lo vendió, se mudó…).
 */
export class VehicleFixedParkingAndRemovalReason1781007500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicles"
        ADD COLUMN IF NOT EXISTS "fixed_parking_asset_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "removal_reason" varchar(300) NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "vehicles"
          ADD CONSTRAINT "FK_vehicles_fixed_parking_asset"
          FOREIGN KEY ("fixed_parking_asset_id")
          REFERENCES "unit_assets"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // Un parqueadero fijo es de un solo vehículo vigente.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vehicles_fixed_parking_asset"
        ON "vehicles" ("fixed_parking_asset_id")
        WHERE "fixed_parking_asset_id" IS NOT NULL AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_vehicles_fixed_parking_asset"`,
    );
    await queryRunner.query(`
      ALTER TABLE "vehicles"
        DROP CONSTRAINT IF EXISTS "FK_vehicles_fixed_parking_asset",
        DROP COLUMN IF EXISTS "fixed_parking_asset_id",
        DROP COLUMN IF EXISTS "removal_reason"
    `);
  }
}
