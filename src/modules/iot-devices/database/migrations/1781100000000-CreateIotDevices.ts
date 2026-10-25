import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Módulo IoT: SOLO crea tablas nuevas (prefijo iot_). No hace ALTER, DROP ni
 * RENAME sobre nada existente; las únicas referencias a tablas existentes son
 * claves foráneas DESDE las tablas nuevas (users, residential_complexes, units).
 *
 * Vive en la carpeta del módulo y la aplica su propio data-source
 * (iot-data-source.ts, tabla de control `iot_migrations`): el
 * `yarn migration:run` de siempre NO la ve ni la ejecuta.
 *
 * down() lo deja todo como estaba: borra solo estas tablas.
 */
export class CreateIotDevices1781100000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_devices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "type" varchar(32) NOT NULL,
        "device_id" varchar(40) NOT NULL,
        "device_key_hash" varchar(100) NOT NULL,
        "pairing_code" varchar(12),
        "pairing_code_expires_at" timestamptz,
        "name" varchar(80),
        "firmware_version" varchar(32),
        "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "complex_id" uuid NOT NULL REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        "unit_id" uuid REFERENCES "units"("id") ON DELETE SET NULL,
        "status" varchar(16) NOT NULL DEFAULT 'UNPROVISIONED',
        "connected" boolean NOT NULL DEFAULT false,
        "power" varchar(16),
        "last_seen_at" timestamptz,
        "last_telemetry" jsonb,
        "last_ack" jsonb,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_iot_devices_device_id" UNIQUE ("device_id")
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_iot_devices_complex" ON "iot_devices" ("complex_id")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_iot_devices_owner" ON "iot_devices" ("owner_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_iot_devices_pairing_code" ON "iot_devices" ("pairing_code") WHERE "pairing_code" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_planter_readings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "device_uuid" uuid NOT NULL REFERENCES "iot_devices"("id") ON DELETE CASCADE,
        "soil" smallint NOT NULL,
        "soil_raw" integer,
        "lux" real,
        "temp_c" real,
        "hum" smallint,
        "battery" real NOT NULL,
        "battery_pct" smallint,
        "power" varchar(16),
        "tank_has_water" boolean NOT NULL,
        "mood" varchar(40),
        "motion" boolean,
        "tilt" smallint,
        "plant_id" varchar(64),
        "faults" text[] NOT NULL DEFAULT '{}',
        "rssi" smallint,
        "queued" boolean NOT NULL DEFAULT false,
        "measured_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    // Único: la misma lectura dos veces (MQTT + REST, reintento) se descarta
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_iot_planter_readings_device_measured" ON "iot_planter_readings" ("device_uuid", "measured_at")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_iot_planter_readings_device_created" ON "iot_planter_readings" ("device_uuid", "created_at")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_device_alerts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "device_uuid" uuid NOT NULL REFERENCES "iot_devices"("id") ON DELETE CASCADE,
        "kind" varchar(40) NOT NULL,
        "channels" text[] NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_iot_device_alerts_device_kind_created" ON "iot_device_alerts" ("device_uuid", "kind", "created_at")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_device_outbox" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "device_uuid" uuid NOT NULL REFERENCES "iot_devices"("id") ON DELETE CASCADE,
        "channel" varchar(8) NOT NULL,
        "payload" jsonb NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "delivered_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_iot_device_outbox_device_delivered" ON "iot_device_outbox" ("device_uuid", "delivered_at")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_device_notification_types" (
        "key" varchar(32) PRIMARY KEY,
        "title" varchar(60) NOT NULL,
        "icon" varchar(12) NOT NULL,
        "led_color" varchar(7) NOT NULL,
        "led_pattern" varchar(8) NOT NULL,
        "sound" varchar(12) NOT NULL,
        "priority" smallint NOT NULL DEFAULT 0,
        "interrupts" boolean NOT NULL DEFAULT true,
        "mandatory" boolean NOT NULL DEFAULT false,
        "requires_powered" boolean NOT NULL DEFAULT false,
        "ttl_sec" smallint NOT NULL DEFAULT 20,
        "delivery_ttl_sec" integer NOT NULL DEFAULT 3600,
        "urgent" boolean NOT NULL DEFAULT false,
        "entrylink_types" text[] NOT NULL DEFAULT '{}'
      )`);
    // Semilla del catálogo (tabla nueva). Ampliable sin tocar el firmware.
    await q.query(`
      INSERT INTO "iot_device_notification_types"
        ("key","title","icon","led_color","led_pattern","sound","priority","interrupts","mandatory","requires_powered","ttl_sec","delivery_ttl_sec","urgent","entrylink_types")
      VALUES
        ('PANIC','Alarma de pánico','panic','#FF0000','blink','alarm',100,true,true,true,60,300,true,'{PANIC_ALERT}'),
        ('PACKAGE','Paquete en portería','package','#2E7DFF','pulse','two_beep',50,true,false,false,20,14400,false,'{PACKAGE_RECEIVED,PACKAGE_READY}'),
        ('VISITOR','Tienes una visita','visitor','#FFB300','pulse','two_beep',60,true,false,false,30,600,false,'{VISITOR_WALK_IN,VISITOR_ARRIVED}'),
        ('ADMIN_NOTICE','Aviso de la administración','info','#00C853','solid','beep',30,false,false,false,20,86400,false,'{SYSTEM_ANNOUNCEMENT,COMPLEX_ALERT}')
      ON CONFLICT ("key") DO NOTHING`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_device_notification_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "complex_id" uuid NOT NULL REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        "type_key" varchar(32) NOT NULL REFERENCES "iot_device_notification_types"("key") ON DELETE CASCADE,
        "mandatory" boolean NOT NULL DEFAULT true,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_iot_device_notification_rules" UNIQUE ("complex_id", "type_key")
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_device_notification_prefs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "device_uuid" uuid NOT NULL REFERENCES "iot_devices"("id") ON DELETE CASCADE,
        "type_key" varchar(32) NOT NULL REFERENCES "iot_device_notification_types"("key") ON DELETE CASCADE,
        "enabled" boolean NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_iot_device_notification_prefs" UNIQUE ("user_id", "device_uuid", "type_key")
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Orden inverso por las claves foráneas. Solo tablas de este módulo.
    await q.query(`DROP TABLE IF EXISTS "iot_device_notification_prefs"`);
    await q.query(`DROP TABLE IF EXISTS "iot_device_notification_rules"`);
    await q.query(`DROP TABLE IF EXISTS "iot_device_notification_types"`);
    await q.query(`DROP TABLE IF EXISTS "iot_device_outbox"`);
    await q.query(`DROP TABLE IF EXISTS "iot_device_alerts"`);
    await q.query(`DROP TABLE IF EXISTS "iot_planter_readings"`);
    await q.query(`DROP TABLE IF EXISTS "iot_devices"`);
  }
}
