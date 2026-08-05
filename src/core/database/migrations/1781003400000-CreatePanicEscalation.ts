import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Escalamiento de alertas de pánico.
 *
 * 1. "panic_escalation_settings": tiempos por complejo. Van en tabla y no en
 *    constantes porque el tiempo razonable depende del conjunto. Un complejo sin
 *    fila usa los defaults de las columnas, así que no hay que sembrar nada.
 * 2. "panic_alert_deliveries": auditoría de un envío por destino y canal. Es lo
 *    que permite medir la tasa real de entrega —y por marca de dispositivo, vía
 *    el join con push_subscriptions— en vez de suponerla.
 *
 * Aditiva y reversible: solo crea tablas nuevas.
 */
export class CreatePanicEscalation1781003400000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "panic_delivery_channel_enum" AS ENUM (
          'FCM', 'SOCKET', 'EMAIL', 'WHATSAPP', 'SMS', 'VOICE'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "panic_escalation_settings" (
        "id"                      uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id"              uuid NOT NULL,
        "is_enabled"              boolean NOT NULL DEFAULT true,
        "level1_delay_seconds"    integer NOT NULL DEFAULT 15,
        "level2_delay_seconds"    integer NOT NULL DEFAULT 45,
        "level3_delay_seconds"    integer NOT NULL DEFAULT 90,
        "emergency_contact_email" varchar(180),
        "emergency_contact_phone" varchar(40),
        "created_at"              timestamptz NOT NULL DEFAULT now(),
        "updated_at"              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_panic_escalation_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_panic_escalation_settings_complex" UNIQUE ("complex_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "panic_alert_deliveries" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "panic_alert_id"  uuid NOT NULL,
        "user_id"         uuid,
        "device_token_id" uuid,
        "channel"         "panic_delivery_channel_enum" NOT NULL,
        "escalation_level" integer NOT NULL DEFAULT 0,
        "sent_at"         timestamptz NOT NULL DEFAULT now(),
        "delivered_at"    timestamptz,
        "acknowledged_at" timestamptz,
        "failure_reason"  text,
        CONSTRAINT "PK_panic_alert_deliveries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_panic_alert_deliveries_alert" FOREIGN KEY ("panic_alert_id")
          REFERENCES "panic_alerts" ("id") ON DELETE CASCADE
      )
    `);

    // El escalamiento pregunta "¿alguien entregó esta alerta?" en cada nivel.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_panic_alert_deliveries_alert"
        ON "panic_alert_deliveries" ("panic_alert_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_panic_alert_deliveries_alert_channel"
        ON "panic_alert_deliveries" ("panic_alert_id", "channel")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_panic_alert_deliveries_alert_channel"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_panic_alert_deliveries_alert"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "panic_alert_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "panic_escalation_settings"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "panic_delivery_channel_enum"`);
  }
}
