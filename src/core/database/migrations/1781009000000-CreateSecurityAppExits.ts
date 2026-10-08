import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Salidas de los vigilantes de la app de portería.
 *
 * La portería no debe salir de EntryLink durante el turno. Cada vez que la saca
 * a segundo plano queda una fila; al volver se cierra con la duración. La
 * administración decide si además quiere un aviso y con cuántos minutos de
 * margen (por defecto apagado, para no estrenar avisos sin que nadie los pida).
 *
 * El índice único parcial deja una sola salida abierta por vigilante.
 */
export class CreateSecurityAppExits1781009000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_app_exits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "guard_id" uuid NOT NULL,
        "left_at" timestamptz NOT NULL,
        "returned_at" timestamptz,
        "duration_seconds" int,
        "alert_sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_app_exits" PRIMARY KEY ("id"),
        CONSTRAINT "FK_security_app_exits_guard" FOREIGN KEY ("guard_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_security_app_exits_complex_left_at"
        ON "security_app_exits" ("complex_id", "left_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_security_app_exits_open_guard"
        ON "security_app_exits" ("guard_id")
        WHERE "returned_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "guard_exit_alert_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "guard_exit_alert_minutes" int NOT NULL DEFAULT 0
    `);

    // Tipo de notificación nuevo. Se agrega sin usarse en esta transacción.
    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const rows = (await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      )) as { exists: boolean }[];
      if (!rows[0]?.exists) continue;

      await queryRunner.query(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'SECURITY_APP_EXIT'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // El valor del enum de notificaciones no se puede quitar en Postgres.
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "guard_exit_alert_minutes",
        DROP COLUMN IF EXISTS "guard_exit_alert_enabled"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_app_exits"`);
  }
}
