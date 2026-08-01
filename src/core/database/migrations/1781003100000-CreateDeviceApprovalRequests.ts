import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aprobación de ingreso desde un dispositivo confiable, avisada por push.
 * Sustituye al OTP por WhatsApp para el residente que ya usa la aplicación en
 * otro equipo: el push (FCM / Web Push) no tiene costo por mensaje.
 *
 * También agrega el label LOGIN_APPROVAL_REQUEST al enum nativo
 * "notifications_type_enum". Con `synchronize: false` el valor del enum TS no
 * existe en Postgres hasta migrarlo, y sin él un INSERT de esa notificación
 * fallaría.
 *
 * Idempotente (IF NOT EXISTS) por si en dev se corrió `synchronize`.
 */
export class CreateDeviceApprovalRequests1781003100000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "device_approval_requests" (
        "id"                     uuid NOT NULL DEFAULT uuid_generate_v4(),
        "approval_id"            uuid NOT NULL,
        "approval_code"          varchar(8) NOT NULL,
        "identity"               varchar(20) NOT NULL,
        "user_id"                uuid,
        "status"                 varchar(20) NOT NULL DEFAULT 'PENDING',
        "expires_at"             timestamptz NOT NULL,
        "resolved_at"            timestamptz,
        "resolved_by_session_id" text,
        "device_fingerprint"     text NOT NULL,
        "requested_from_label"   varchar(120),
        "requested_from_ip"      varchar(45),
        "created_at"             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_device_approval_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_device_approval_requests_approval_id" UNIQUE ("approval_id"),
        CONSTRAINT "FK_device_approval_requests_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // El canje y la limpieza filtran por estado + vigencia.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_device_approval_requests_status_expiry"
        ON "device_approval_requests" ("status", "expires_at")
    `);

    // Listar las solicitudes pendientes del residente autenticado.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_device_approval_requests_user_status"
        ON "device_approval_requests" ("user_id", "status")
    `);

    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );

    if (exists) {
      await queryRunner.query(
        `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'LOGIN_APPROVAL_REQUEST'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels es no destructivo.
    await queryRunner.query(`DROP TABLE IF EXISTS "device_approval_requests"`);
  }
}
