import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, entrega 1B (1/3): valores de enum de los permisos de
 * deduplicación y scoring. Fuera de transacción (ADD VALUE).
 */
export const GROWTH_DEDUPE_PERMISSION_ENUM_VALUES = [
  'MERGE_GROWTH_DUPLICATES',
  'MANAGE_GROWTH_SCORING',
];

export class GrowthDedupeScoringPermissionsEnum1781010600000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of GROWTH_DEDUPE_PERMISSION_ENUM_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no permite quitar valores de un enum; sin filas son inocuos.
  }
}
