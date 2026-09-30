import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cuándo tomó el equipo la lectura de GPS del pánico.
 *
 * Latitud, longitud y precisión ya existían en `panic_alerts` pero nadie las
 * llenaba. La hora de la lectura es lo que permite decir "ubicación de hace
 * 40 s" en vez de presentar como actual una posición vieja.
 */
export class PanicAlertLocationCapturedAt1781007300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "panic_alerts"
        ADD COLUMN IF NOT EXISTS "location_captured_at" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "panic_alerts"
        DROP COLUMN IF EXISTS "location_captured_at"
    `);
  }
}
