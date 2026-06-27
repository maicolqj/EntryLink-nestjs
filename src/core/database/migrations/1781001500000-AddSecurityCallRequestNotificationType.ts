import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label SECURITY_CALL_REQUEST al enum nativo "notifications_type_enum".
 *
 * La columna notifications.type es un enum nativo de Postgres y el proyecto corre
 * con `synchronize: false`, así que un nuevo valor del enum TS NO existe en el tipo
 * Postgres hasta migrarlo. Sin esto, el INSERT de la notificación de "solicitud de
 * llamada" fallaría con "invalid input value for enum notifications_type_enum" y,
 * como notify() es fire-and-forget, el error se tragaría en silencio (sin fila,
 * sin socket, sin push) — mismo patrón que el drift de finanzas.
 *
 * Idempotente: `ADD VALUE IF NOT EXISTS` (PG 12+).
 */
export class AddSecurityCallRequestNotificationType1781001500000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );
    if (!exists) return;

    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'SECURITY_CALL_REQUEST'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels es no destructivo.
  }
}
