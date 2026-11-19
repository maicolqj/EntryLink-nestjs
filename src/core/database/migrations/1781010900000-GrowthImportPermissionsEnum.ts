import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, entrega 1C (1/3): valor de enum del permiso de
 * importaciones. Fuera de transacción (ADD VALUE).
 */
export const GROWTH_IMPORT_PERMISSION_ENUM_VALUES = ['IMPORT_GROWTH_DATA'];

export class GrowthImportPermissionsEnum1781010900000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of GROWTH_IMPORT_PERMISSION_ENUM_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no permite quitar valores de un enum; sin filas son inocuos.
  }
}
