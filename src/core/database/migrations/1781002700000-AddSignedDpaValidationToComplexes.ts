import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Añade a "residential_complexes" el estado de validación del DPA firmado:
 *  - signed_dpa_status: enum PENDING/APPROVED/REJECTED (veredicto del SUPER_ADMIN)
 *  - signed_dpa_rejection_reason: motivo cuando se rechaza
 *  - signed_dpa_reviewed_at / signed_dpa_reviewed_by_id: auditoría de la revisión
 *
 * El nombre del tipo enum sigue la convención de TypeORM
 * ("<tabla>_<columna>_enum") para alinearse con la entidad. Idempotente.
 */
export class AddSignedDpaValidationToComplexes1781002700000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'residential_complexes_signed_dpa_status_enum') THEN
          CREATE TYPE "residential_complexes_signed_dpa_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
        END IF;
      END $$;
    `);
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_status" "residential_complexes_signed_dpa_status_enum"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_rejection_reason" text`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_reviewed_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_reviewed_by_id" text`);

    // DPA ya subidos antes de esta feature quedan como PENDING de revisión.
    await queryRunner.query(`UPDATE "residential_complexes" SET "signed_dpa_status" = 'PENDING' WHERE "signed_dpa_url" IS NOT NULL AND "signed_dpa_status" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_reviewed_by_id"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_reviewed_at"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_rejection_reason"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "residential_complexes_signed_dpa_status_enum"`);
  }
}
