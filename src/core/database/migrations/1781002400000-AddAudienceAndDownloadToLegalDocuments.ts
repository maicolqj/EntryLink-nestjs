import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Añade a "legal_documents":
 *  - audience (PUBLIC | COMPLEX): dónde aparece el documento.
 *  - is_downloadable + download_file_url/name/public_id: PDF descargable (ej. DPA a firmar).
 *
 * Marca el Anexo B2B (DPA) como audience=COMPLEX (solo complejos registrados).
 * Idempotente por si en dev se corrió `synchronize`.
 */
export class AddAudienceAndDownloadToLegalDocuments1781002400000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "legal_documents_audience_enum" AS ENUM ('PUBLIC', 'COMPLEX');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "legal_documents"
      ADD COLUMN IF NOT EXISTS "audience" "legal_documents_audience_enum" NOT NULL DEFAULT 'PUBLIC'
    `);
    await queryRunner.query(`
      ALTER TABLE "legal_documents"
      ADD COLUMN IF NOT EXISTS "is_downloadable" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "download_file_url" text`);
    await queryRunner.query(`ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "download_file_name" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "download_file_public_id" text`);

    // El Anexo B2B (DPA) solo debe verse/descargarse por complejos registrados.
    await queryRunner.query(`
      UPDATE "legal_documents"
      SET "audience" = 'COMPLEX'
      WHERE "slug" = 'acuerdo-tratamiento-datos'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "legal_documents" DROP COLUMN IF EXISTS "download_file_public_id"`);
    await queryRunner.query(`ALTER TABLE "legal_documents" DROP COLUMN IF EXISTS "download_file_name"`);
    await queryRunner.query(`ALTER TABLE "legal_documents" DROP COLUMN IF EXISTS "download_file_url"`);
    await queryRunner.query(`ALTER TABLE "legal_documents" DROP COLUMN IF EXISTS "is_downloadable"`);
    await queryRunner.query(`ALTER TABLE "legal_documents" DROP COLUMN IF EXISTS "audience"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "legal_documents_audience_enum"`);
  }
}
