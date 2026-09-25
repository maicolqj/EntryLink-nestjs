import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label PROFILE_UPDATED a los enums nativos de notificaciones.
 *
 * El valor existe en `NotificationType` desde que se avisa al usuario de que
 * alguien modificó sus datos personales, pero nunca tuvo migración: el esquema
 * ya no se sincroniza solo y el label no llegó a Postgres.
 *
 * Mientras solo fallaba el INSERT del aviso pasó desapercibido (`notify()` es
 * fire-and-forget). Desde que la bandeja del residente filtra por
 * `n.type IN (...RESIDENT_VISIBLE_TYPES)` —que incluye PROFILE_UPDATED por ser
 * de audiencia ANY— Postgres rechaza la consulta entera con
 * `invalid input value for enum`, y `myNotifications` y
 * `unreadNotificationsCount` fallan para toda sesión de residente: la app queda
 * con el historial vacío al reabrirse. Idempotente con `ADD VALUE IF NOT EXISTS`.
 */
export class AddProfileUpdatedNotificationType1781007000000
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
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'PROFILE_UPDATED'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels no es destructivo.
  }
}
