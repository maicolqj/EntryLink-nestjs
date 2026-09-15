import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label PET_REMOVED a los enums nativos de notificaciones.
 *
 * Lo usa el aviso que le llega a la administración cuando una ficha sale: el
 * residente elimina un registro que aún no se validaba, o retira del censo a
 * una mascota que sí vivía ahí. Sin el label, el INSERT falla y —como notify()
 * es fire-and-forget— el error se traga en silencio: la administración se
 * quedaría revisando una ficha que ya no existe.
 *
 * Va aparte de CreatePets porque esa migración ya corrió en las bases que
 * existen. Idempotente: `ADD VALUE IF NOT EXISTS` (PG 12+).
 */
export class AddPetRemovedNotificationType1781005100000
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
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'PET_REMOVED'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels no es destructivo.
  }
}
