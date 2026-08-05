import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alerta de pánico como agregado propio.
 *
 * Hasta ahora un pánico solo existía como N filas de "notifications"
 * correlacionadas por una ventana de ±30s: reconocer una alerta cerraba
 * cualquier otra del mismo complejo caída en esa ventana. Esta tabla le da un
 * identificador real al incidente, y "notifications" lo referencia.
 *
 * Aditiva y reversible: la columna nueva de "notifications" es nullable, así
 * que las filas históricas quedan con NULL y el código sigue resolviéndolas por
 * la ventana antigua.
 */
export class CreatePanicAlerts1781003300000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Los enums nativos no admiten CREATE TYPE IF NOT EXISTS; el bloque hace
    // idempotente la migración por si en dev se corrió `synchronize`.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "panic_alerts_type_enum" AS ENUM ('PANIC', 'MEDICAL', 'FIRE', 'INTRUSION');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "panic_alerts_status_enum" AS ENUM (
          'PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "panic_alerts" (
        "id"                      uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id"              uuid NOT NULL,
        "unit_id"                 uuid,
        "resident_id"             uuid,
        "triggered_by_user_id"    uuid NOT NULL,
        "triggered_by_label"      varchar(180),
        "type"                    "panic_alerts_type_enum" NOT NULL DEFAULT 'PANIC',
        "latitude"                numeric(10,7),
        "longitude"               numeric(10,7),
        "accuracy"                numeric(8,2),
        "status"                  "panic_alerts_status_enum" NOT NULL DEFAULT 'PENDING',
        "delivered_at"            timestamptz,
        "acknowledged_by_user_id" uuid,
        "acknowledged_at"         timestamptz,
        "resolved_at"             timestamptz,
        "resolved_by_user_id"     uuid,
        "resolution_notes"        text,
        "escalation_level"        integer NOT NULL DEFAULT 0,
        "created_at"              timestamptz NOT NULL DEFAULT now(),
        "updated_at"              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_panic_alerts_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_panic_alerts_complex_created"
        ON "panic_alerts" ("complex_id", "created_at")
    `);

    // El escalamiento y la portería preguntan por lo que sigue abierto.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_panic_alerts_complex_status"
        ON "panic_alerts" ("complex_id", "status")
    `);

    // Enlace desde las notificaciones. Sin FK a propósito: "notifications" ya
    // referencia entidades por id suelto (entityId/entityType) y una FK con
    // ON DELETE forzaría decidir qué pasa con el buzón del usuario si se
    // depura un incidente. Nullable para el histórico.
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD COLUMN IF NOT EXISTS "panic_alert_id" uuid
    `);

    // Reconocer una alerta actualiza todas sus notificaciones hermanas.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_panic_alert_id"
        ON "notifications" ("panic_alert_id")
        WHERE "panic_alert_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_panic_alert_id"`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN IF EXISTS "panic_alert_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_panic_alerts_complex_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_panic_alerts_complex_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "panic_alerts"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "panic_alerts_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "panic_alerts_type_enum"`);
  }
}
