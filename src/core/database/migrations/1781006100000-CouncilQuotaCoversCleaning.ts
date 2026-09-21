import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El cupo anual del consejo puede cubrir también el aseo.
 *
 * El beneficio se pensó sobre el uso de la zona, así que hasta ahora un
 * consejero con cupo pagaba igual el servicio de aseo y su reserva no llegaba a
 * saldo cero —lo que, con la compuerta del código de ingreso, le dejaba la
 * reserva sin llave—. Quién paga ese servicio es decisión de cada
 * administración, no una consecuencia del cupo, así que se vuelve un
 * interruptor de la zona.
 *
 * Nace apagado: conserva el comportamiento que las zonas tienen hoy.
 */
export class CouncilQuotaCoversCleaning1781006100000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenities"
        ADD COLUMN IF NOT EXISTS "council_quota_covers_cleaning" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenities"
        DROP COLUMN IF EXISTS "council_quota_covers_cleaning"
    `);
  }
}
