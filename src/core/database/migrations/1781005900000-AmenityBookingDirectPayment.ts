import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pago del alquiler recibido en la administración, atado a la reserva.
 *
 * El alquiler se cobra por la cartera de la unidad o se recibe en efectivo en
 * la administración, pero nunca las dos. El resumen financiero suma
 * `totalCollected + directIncome`, así que un cargo colgando de la unidad más
 * un ingreso directo por lo mismo contaría el alquiler dos veces.
 *
 * `direct_income_id` apunta al `direct_incomes` que se creó al recibir el pago;
 * mientras sea null, la reserva va por cartera, que es lo que pasa por defecto.
 *
 * Sin FK a `direct_incomes`: el ingreso se puede revertir desde finanzas sin
 * que eso deba borrar la reserva, y una FK con ON DELETE RESTRICT bloquearía
 * esa reversión.
 */
export class AmenityBookingDirectPayment1781005900000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        ADD COLUMN IF NOT EXISTS "direct_income_id" uuid,
        ADD COLUMN IF NOT EXISTS "direct_payment_amount" numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "direct_payment_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "direct_payment_by_user_id" uuid
    `);

    // Para responder "¿qué reserva generó este ingreso?" desde finanzas.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_bookings_direct_income"
        ON "amenity_bookings" ("direct_income_id")
        WHERE "direct_income_id" IS NOT NULL
    `);

    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const [{ exists }] = await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      );
      if (!exists) continue;

      await queryRunner.query(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'AMENITY_PAYMENT_RECEIVED'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_amenity_bookings_direct_income"
    `);

    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        DROP COLUMN IF EXISTS "direct_income_id",
        DROP COLUMN IF EXISTS "direct_payment_amount",
        DROP COLUMN IF EXISTS "direct_payment_at",
        DROP COLUMN IF EXISTS "direct_payment_by_user_id"
    `);

    // Postgres no soporta DROP VALUE en un enum; agregar labels no es destructivo.
  }
}
