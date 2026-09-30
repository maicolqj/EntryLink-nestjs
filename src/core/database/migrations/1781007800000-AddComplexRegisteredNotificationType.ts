import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label COMPLEX_REGISTERED al enum nativo "notifications_type_enum".
 * Avisa al SUPER_ADMIN cuando un complejo se registra desde el formulario
 * público y queda en PENDING_REVIEW; antes el registro no avisaba a nadie.
 *
 * Idempotente: ADD VALUE IF NOT EXISTS (PG 12+).
 */
export class AddComplexRegisteredNotificationType1781007800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );
    if (!exists) return;

    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'COMPLEX_REGISTERED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels es no destructivo.
  }
}
