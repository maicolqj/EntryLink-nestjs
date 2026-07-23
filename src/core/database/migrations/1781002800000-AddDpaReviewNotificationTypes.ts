import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega los labels DPA_APPROVED y DPA_REJECTED al enum nativo
 * "notifications_type_enum". Se usan para avisar al complejo del veredicto
 * del SUPER_ADMIN sobre su DPA firmado. Idempotente (ADD VALUE IF NOT EXISTS).
 */
export class AddDpaReviewNotificationTypes1781002800000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );
    if (!exists) return;

    await queryRunner.query(`ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'DPA_APPROVED'`);
    await queryRunner.query(`ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'DPA_REJECTED'`);
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels es no destructivo.
  }
}
