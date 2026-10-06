import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Motivo y fecha de la suspensión manual de un complejo. La administración
 * suspendida entra a una pantalla que le explica por qué, en vez de chocar con
 * un "contacta al administrador" sin más.
 */
export class ComplexSuspensionReason1781008900000 implements MigrationInterface {
  name = 'ComplexSuspensionReason1781008900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "suspension_reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "suspended_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "suspension_reason"`,
    );
  }
}
