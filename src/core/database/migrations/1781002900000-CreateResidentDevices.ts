import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login de residentes por dispositivo + PIN (elimina el costo por mensaje de
 * WhatsApp en cada inicio de sesión).
 *
 * 1. Tabla "resident_devices": vincula un dispositivo verificado a un residente
 *    y guarda el hash del PIN que lo desbloquea.
 * 2. Columna "refresh_expiry" en "refresh_tokens": persiste la política de
 *    vigencia usada al emitir el token para que la rotación no la degrade
 *    (una sesión de residente de 180d debe seguir siendo de 180d tras rotar).
 *
 * Idempotente (IF NOT EXISTS) por si en dev se corrió `synchronize`.
 */
export class CreateResidentDevices1781002900000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "resident_devices" (
        "id"                 uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"            uuid NOT NULL,
        "device_id"          varchar(128) NOT NULL,
        "device_fingerprint" text NOT NULL,
        "pin_hash"           text NOT NULL,
        "label"              varchar(120),
        "platform"           varchar(20),
        "failed_attempts"    smallint NOT NULL DEFAULT 0,
        "locked_until"       timestamptz,
        "is_revoked"         boolean NOT NULL DEFAULT false,
        "revoked_reason"     varchar(60),
        "session_id"         text,
        "last_used_at"       timestamptz,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_resident_devices_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_resident_devices_user_device" UNIQUE ("user_id", "device_id"),
        CONSTRAINT "FK_resident_devices_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_resident_devices_user_id"
        ON "resident_devices" ("user_id")
    `);

    // El login busca por deviceId descartando los revocados.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_resident_devices_device_active"
        ON "resident_devices" ("device_id", "is_revoked")
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN IF NOT EXISTS "refresh_expiry" varchar(10)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "refresh_expiry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "resident_devices"`);
  }
}
