import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plantillas de importación personales y del equipo (1/2): valor de enum del
 * permiso nuevo. Fuera de transacción (ADD VALUE).
 */
export const GROWTH_TEMPLATE_PERMISSION_ENUM_VALUES = [
  'MANAGE_GROWTH_IMPORT_TEMPLATES',
];

export class GrowthImportTemplatesPermissionEnum1781011300000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of GROWTH_TEMPLATE_PERMISSION_ENUM_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no permite quitar valores de un enum; sin filas son inocuos.
  }
}
