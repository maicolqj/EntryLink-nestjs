import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label NEW_DEVICE_LINKED al enum nativo "notifications_type_enum".
 *
 * Es el aviso de seguridad que se envía a los equipos ya vinculados cuando uno
 * nuevo entra con documento + clave. Con `synchronize: false` el valor del enum
 * TS no existe en Postgres hasta migrarlo, y sin él el INSERT de esa
 * notificación falla en silencio dentro del best-effort del login.
 *
 * Idempotente (ADD VALUE IF NOT EXISTS).
 */
export class AddNewDeviceLinkedNotificationType1781003300000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );
    if (!exists) return;

    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'NEW_DEVICE_LINKED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels es no destructivo.
  }
}
