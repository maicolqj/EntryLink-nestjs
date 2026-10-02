import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Días gratis con duración y motivo por complejo.
 *
 * - `subscription_period_kind` += COURTESY: días regalados por recomendar a
 *   otro conjunto, promoción u otro motivo. A diferencia de la prueba (TRIAL),
 *   se pueden dar varias veces.
 * - `subscription_periods.free_reason`: TRIAL | REFERRAL | PROMOTION | OTHER.
 *   Las pruebas ya otorgadas quedan con TRIAL.
 *
 * ADD VALUE IF NOT EXISTS es idempotente (PG 12+) y el valor nuevo no se usa
 * dentro de esta misma migración.
 */
export class SubscriptionFreeDaysByComplex1781008200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "subscription_period_kind" ADD VALUE IF NOT EXISTS 'COURTESY'`,
    );

    await queryRunner.query(`
      ALTER TABLE "subscription_periods"
        ADD COLUMN IF NOT EXISTS "free_reason" varchar(20)
    `);
    await queryRunner.query(`
      UPDATE "subscription_periods"
         SET "free_reason" = 'TRIAL'
       WHERE "kind" = 'TRIAL' AND "free_reason" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription_periods" DROP COLUMN IF EXISTS "free_reason"
    `);
    // Postgres no soporta DROP VALUE en un enum: COURTESY queda en el tipo.
  }
}
