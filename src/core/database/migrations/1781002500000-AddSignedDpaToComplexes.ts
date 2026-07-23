import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Añade a "residential_complexes" los campos del DPA (Anexo B2B) firmado
 * que sube el propio complejo y queda adjunto a sus documentos.
 * Idempotente por si en dev se corrió `synchronize`.
 */
export class AddSignedDpaToComplexes1781002500000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_url" text`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_file_name" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_uploaded_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "signed_dpa_public_id" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_public_id"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_uploaded_at"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_file_name"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "signed_dpa_url"`);
  }
}
