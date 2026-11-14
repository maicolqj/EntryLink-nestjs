import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tramos en que un conjunto tuvo las automatizaciones pausadas por no renovar.
 * Solo agrega una tabla: no toca datos existentes.
 */
export class CreateSubscriptionPauses1781011900000 implements MigrationInterface {
  name = 'CreateSubscriptionPauses1781011900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_pauses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "paused_at" TIMESTAMPTZ NOT NULL,
        "resumed_at" TIMESTAMPTZ NOT NULL,
        "days" integer NOT NULL,
        "recurring_caught_up_at" TIMESTAMPTZ,
        CONSTRAINT "PK_subscription_pauses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscription_pauses_complex_paused" UNIQUE ("complex_id", "paused_at"),
        CONSTRAINT "FK_subscription_pauses_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_pauses_complex_resumed"
        ON "subscription_pauses" ("complex_id", "resumed_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_pauses"`);
  }
}
