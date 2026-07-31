import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login "reverse-OTP" de residentes: el residente envía un nonce desde su
 * propio WhatsApp en vez de recibir una plantilla de Meta. Los mensajes
 * entrantes no se cobran, así que el flujo de recuperación de acceso deja de
 * generar costo.
 *
 * `user_id` es nullable a propósito: el challenge se emite aunque la identidad
 * no exista, para no revelar qué documentos están registrados.
 *
 * Idempotente (IF NOT EXISTS) por si en dev se corrió `synchronize`.
 */
export class CreateWhatsAppLoginChallenges1781003000000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "whatsapp_login_challenges" (
        "id"                   uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nonce"                varchar(16) NOT NULL,
        "identity"             varchar(20) NOT NULL,
        "user_id"              uuid,
        "status"               varchar(20) NOT NULL DEFAULT 'PENDING',
        "expires_at"           timestamptz NOT NULL,
        "confirmed_at"         timestamptz,
        "confirmed_from_phone" varchar(20),
        "device_fingerprint"   text NOT NULL,
        "requested_from_ip"    varchar(45),
        "created_at"           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_login_challenges_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_whatsapp_login_challenges_nonce" UNIQUE ("nonce"),
        CONSTRAINT "FK_whatsapp_login_challenges_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // El webhook busca por nonce; la limpieza y el canje filtran por estado+vigencia.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_whatsapp_login_challenges_status_expiry"
        ON "whatsapp_login_challenges" ("status", "expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_login_challenges"`);
  }
}
