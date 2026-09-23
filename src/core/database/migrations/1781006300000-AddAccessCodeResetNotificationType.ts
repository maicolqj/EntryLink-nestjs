import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label ACCESS_CODE_RESET a los enums nativos de notificaciones.
 *
 * Lo usa el aviso que recibe el residente cuando la administración le borra la
 * clave de acceso olvidada. Es un aviso de SEGURIDAD: si no fue él quien lo
 * pidió, es lo único que le dice que alguien tocó su acceso.
 *
 * Va aparte porque `notifications.type` y `notification_batches.type` son enums
 * NATIVOS de Postgres. Sin el label el INSERT falla y —como `notify()` es
 * fire-and-forget— el error se traga en silencio: justo el aviso que no puede
 * perderse. Idempotente con `ADD VALUE IF NOT EXISTS` (PG 12+).
 */
export class AddAccessCodeResetNotificationType1781006300000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const [{ exists }] = await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      );
      if (!exists) continue;

      await queryRunner.query(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'ACCESS_CODE_RESET'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels no es destructivo.
  }
}
