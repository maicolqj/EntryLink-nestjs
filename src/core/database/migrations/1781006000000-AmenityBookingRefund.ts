import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Devolución del dinero al cancelar una reserva ya pagada.
 *
 * Hasta ahora, cancelar una reserva cuyo cargo tenía abonos no devolvía nada:
 * `cancelInternalCharge` deja intocable cualquier cargo con `paid_amount > 0` y
 * devolvía null en silencio, así que el residente terminaba pagando algo que
 * canceló a tiempo. La plata ahora sale de caja con su comprobante de egreso
 * —débito 4295, crédito 1105— y queda anotada en la reserva.
 *
 * `refund_voucher_id` puede quedar en null cuando el complejo aún no tiene PUC
 * configurado: el comprobante no se emite, pero la devolución igual queda
 * escrita. Que falte el plan de cuentas no puede borrar el hecho de que hay
 * plata por devolverle a alguien.
 */
export class AmenityBookingRefund1781006000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        ADD COLUMN IF NOT EXISTS "refund_amount" numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "refund_voucher_id" uuid,
        ADD COLUMN IF NOT EXISTS "refunded_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        DROP COLUMN IF EXISTS "refund_amount",
        DROP COLUMN IF EXISTS "refund_voucher_id",
        DROP COLUMN IF EXISTS "refunded_at"
    `);
  }
}
