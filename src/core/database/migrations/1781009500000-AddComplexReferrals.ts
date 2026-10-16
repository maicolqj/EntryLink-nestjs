import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recomendaciones entre conjuntos.
 *
 * - referral_code: código que el conjunto comparte. Se genera la primera vez
 *   que se consulta, por eso queda vacío en los que ya existen.
 * - referred_by_complex_id: quién lo recomendó (código al registrarse o
 *   asignado por el SUPER_ADMIN).
 * - referral_rewarded_at: cuándo se otorgó la cortesía al que recomendó. Marca
 *   que el premio ya se dio y no se repite.
 *
 * Idempotente por si en dev se corrió `synchronize`.
 */
export class AddComplexReferrals1781009500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "referral_code" varchar(12)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_residential_complexes_referral_code" ON "residential_complexes" ("referral_code") WHERE "referral_code" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "referred_by_complex_id" uuid`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "residential_complexes"
          ADD CONSTRAINT "FK_residential_complexes_referred_by"
          FOREIGN KEY ("referred_by_complex_id") REFERENCES "residential_complexes"("id")
          ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_residential_complexes_referred_by" ON "residential_complexes" ("referred_by_complex_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "referral_rewarded_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_residential_complexes_referred_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "residential_complexes" DROP CONSTRAINT IF EXISTS "FK_residential_complexes_referred_by"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_residential_complexes_referral_code"`,
    );
    for (const column of [
      'referral_rewarded_at',
      'referred_by_complex_id',
      'referral_code',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
