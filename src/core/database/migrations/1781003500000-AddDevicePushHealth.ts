import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Salud de entrega push por dispositivo.
 *
 * 1. Metadata de equipo en "push_subscriptions". Sin marca y modelo no se puede
 *    responder la pregunta que decide el rumbo del proyecto: ¿los pánicos que no
 *    llegan se concentran en ciertos fabricantes (MIUI, ColorOS…) o el problema
 *    es transversal? Todas nullable: los equipos ya registrados no la tienen y
 *    la irán llenando al renovar el token.
 * 2. "device_push_health": resultado de la prueba de humo por dispositivo. Es lo
 *    que permite decirle a un guardia "tu equipo NO está recibiendo alertas"
 *    antes de que ocurra una emergencia real, en vez de descubrirlo entonces.
 *
 * Aditiva y reversible.
 */
export class AddDevicePushHealth1781003500000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "push_subscriptions"
        ADD COLUMN IF NOT EXISTS "device_model"  varchar(120),
        ADD COLUMN IF NOT EXISTS "manufacturer"  varchar(80),
        ADD COLUMN IF NOT EXISTS "os_version"    varchar(40),
        ADD COLUMN IF NOT EXISTS "app_version"   varchar(40),
        ADD COLUMN IF NOT EXISTS "last_seen_at"  timestamptz
    `);

    // Agrupar la tasa de entrega por marca es la consulta que motiva la columna.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_push_subscriptions_manufacturer"
        ON "push_subscriptions" ("manufacturer")
        WHERE "manufacturer" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "device_push_health" (
        "id"                     uuid NOT NULL DEFAULT uuid_generate_v4(),
        "push_subscription_id"   uuid NOT NULL,
        "last_test_sent_at"      timestamptz,
        "last_test_ack_at"       timestamptz,
        "consecutive_failures"   integer NOT NULL DEFAULT 0,
        "is_healthy"             boolean NOT NULL DEFAULT true,
        "has_battery_optimization_disabled" boolean,
        "has_full_screen_intent_permission" boolean,
        "has_notification_permission"       boolean,
        "onboarding_completed_at" timestamptz,
        "created_at"             timestamptz NOT NULL DEFAULT now(),
        "updated_at"             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_device_push_health_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_device_push_health_subscription" UNIQUE ("push_subscription_id"),
        CONSTRAINT "FK_device_push_health_subscription" FOREIGN KEY ("push_subscription_id")
          REFERENCES "push_subscriptions" ("id") ON DELETE CASCADE
      )
    `);

    // El cron semanal barre los equipos que fallaron.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_device_push_health_unhealthy"
        ON "device_push_health" ("is_healthy")
        WHERE "is_healthy" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_device_push_health_unhealthy"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "device_push_health"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_push_subscriptions_manufacturer"`);
    await queryRunner.query(`
      ALTER TABLE "push_subscriptions"
        DROP COLUMN IF EXISTS "last_seen_at",
        DROP COLUMN IF EXISTS "app_version",
        DROP COLUMN IF EXISTS "os_version",
        DROP COLUMN IF EXISTS "manufacturer",
        DROP COLUMN IF EXISTS "device_model"
    `);
  }
}
