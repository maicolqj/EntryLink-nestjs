import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Citofonía por internet.
 *
 * - `residential_complexes.intercom_mode`: SIM (como hoy) o INTERNET. Todos
 *   los conjuntos arrancan en SIM, así que nada cambia hasta que el
 *   SUPER_ADMIN lo decida.
 * - `residential_complexes.resident_intercom_calls_enabled`: el residente
 *   puede llamar a portería por la app (opcional, apagado).
 * - `call_logs.channel`: las llamadas existentes son todas de SIM.
 * - `call_logs.voice_state` / `resident_user_id`: estado en vivo y residente
 *   de las llamadas por internet.
 */
export class IntercomInternetCalls1781012100000 implements MigrationInterface {
  name = 'IntercomInternetCalls1781012100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "intercom_mode" varchar(10) NOT NULL DEFAULT 'SIM',
        ADD COLUMN IF NOT EXISTS "resident_intercom_calls_enabled" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "call_logs"
        ADD COLUMN IF NOT EXISTS "channel" varchar(10) NOT NULL DEFAULT 'SIM',
        ADD COLUMN IF NOT EXISTS "voice_state" varchar(10) NULL,
        ADD COLUMN IF NOT EXISTS "resident_user_id" uuid NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_call_logs_voice_state_started"
        ON "call_logs" ("voice_state", "started_at")
        WHERE "voice_state" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_call_logs_voice_state_started"`,
    );
    await queryRunner.query(`
      ALTER TABLE "call_logs"
        DROP COLUMN IF EXISTS "resident_user_id",
        DROP COLUMN IF EXISTS "voice_state",
        DROP COLUMN IF EXISTS "channel"
    `);
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "resident_intercom_calls_enabled",
        DROP COLUMN IF EXISTS "intercom_mode"
    `);
  }
}
