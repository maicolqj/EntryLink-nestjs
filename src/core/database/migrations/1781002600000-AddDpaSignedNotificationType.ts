import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label DPA_SIGNED al enum nativo "notifications_type_enum".
 * Se usa para avisar al SUPER_ADMIN cuando un complejo sube su DPA firmado.
 *
 * Con `synchronize: false`, el nuevo valor del enum TS no existe en Postgres
 * hasta migrarlo; sin esto el INSERT de la notificación fallaría en silencio
 * (notify() es fire-and-forget). Idempotente: ADD VALUE IF NOT EXISTS (PG 12+).
 */
export class AddDpaSignedNotificationType1781002600000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );
    if (!exists) return;

    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'DPA_SIGNED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels es no destructivo.
  }
}
