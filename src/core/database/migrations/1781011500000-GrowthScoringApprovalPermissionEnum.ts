import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Versiones de scoring con aprobación (1E-C-0, 1/2): valor de enum del
 * permiso de aprobación. Fuera de transacción (ADD VALUE).
 */
export const GROWTH_SCORING_APPROVAL_ENUM_VALUES = ['APPROVE_GROWTH_SCORING'];

export class GrowthScoringApprovalPermissionEnum1781011500000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of GROWTH_SCORING_APPROVAL_ENUM_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no permite quitar valores de un enum; sin filas son inocuos.
  }
}
