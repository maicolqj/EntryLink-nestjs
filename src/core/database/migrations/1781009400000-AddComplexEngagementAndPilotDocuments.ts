import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prueba piloto.
 *
 * - residential_complexes.engagement: PILOT | COMMERCIAL. Los conjuntos que ya
 *   existen quedan COMMERCIAL: firmaron (o deben firmar) el Anexo B2B.
 * - pilot_trial_days: días de prueba que se otorgan al activar un piloto.
 * - pilot_agreement_*: el acuerdo de piloto firmado, archivado al pasar a
 *   comercial para no perder la prueba de lo que se firmó.
 * - legal_documents.engagement: a qué vinculación va dirigido un documento de
 *   complejos. NULL = a todos (lo que había hasta ahora).
 *
 * Idempotente por si en dev se corrió `synchronize`.
 */
export class AddComplexEngagementAndPilotDocuments1781009400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "engagement" varchar(20) NOT NULL DEFAULT 'COMMERCIAL'`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "pilot_trial_days" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "pilot_agreement_public_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "pilot_agreement_file_name" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "pilot_agreement_signed_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "converted_to_commercial_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "legal_documents" ADD COLUMN IF NOT EXISTS "engagement" varchar(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "legal_documents" DROP COLUMN IF EXISTS "engagement"`,
    );
    for (const column of [
      'converted_to_commercial_at',
      'pilot_agreement_signed_at',
      'pilot_agreement_file_name',
      'pilot_agreement_public_id',
      'pilot_trial_days',
      'engagement',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
