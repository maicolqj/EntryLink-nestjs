import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega a "residential_complexes" la columna "accepted_terms_at":
 * marca de tiempo (server-side) de la aceptación de Términos, Política de
 * Privacidad y Acuerdo de Tratamiento de Datos (DPA) durante el registro.
 *
 * Idempotente (IF NOT EXISTS) por si en dev se corrió `synchronize`.
 */
export class AddAcceptedTermsAtToComplexes1781002200000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
      ADD COLUMN IF NOT EXISTS "accepted_terms_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
      DROP COLUMN IF EXISTS "accepted_terms_at"
    `);
  }
}
