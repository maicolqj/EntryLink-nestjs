import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fecha en que se cortó el acceso y el botón de pánico de un conjunto que no
 * renovó. Solo agrega columnas vacías: nadie queda cortado por esta migración.
 */
export class AddSubscriptionAccessCut1781012000000 implements MigrationInterface {
  name = 'AddSubscriptionAccessCut1781012000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "subscription_access_cut_at" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "subscription_panic_cut_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "subscription_access_cut_at",
        DROP COLUMN IF EXISTS "subscription_panic_cut_at"
    `);
  }
}
