import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el label AMENITY_REFUND_PAID a los enums nativos de notificaciones.
 *
 * Lo usa el aviso que recibe el residente cuando la administración le entrega
 * la devolución de una reserva cancelada, con el monto incluido: es su recibo,
 * y sin él no puede confrontar lo que recibió contra lo que el complejo dice
 * que entregó.
 *
 * Va aparte porque `notifications.type` y `notification_batches.type` son enums
 * NATIVOS de Postgres. Sin el label el INSERT falla y —como `notify()` es
 * fire-and-forget— el error se traga en silencio: el residente no se entera y
 * el rastro se pierde. Idempotente con `ADD VALUE IF NOT EXISTS` (PG 12+).
 */
export class AddAmenityRefundNotificationType1781006200000
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
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'AMENITY_REFUND_PAID'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; agregar labels no es destructivo.
  }
}
