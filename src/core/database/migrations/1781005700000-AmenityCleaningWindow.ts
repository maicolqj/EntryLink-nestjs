import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Franja de aseo de las zonas comunes y servicio de aseo del conjunto.
 *
 * Una zona no queda libre en el instante en que el residente sale: hay que
 * recogerla, y cuánto tiempo toma depende de lo que se hizo adentro. La franja
 * la decide la administración reserva por reserva, con un valor sugerido por
 * zona para las que se aprueban solas.
 *
 * `blocked_until_at` es el fin de la OCUPACIÓN —`end_at` más el aseo— y pasa a
 * ser el instante contra el que mide el motor de disponibilidad. Se guarda
 * calculado en vez de sumarse en cada consulta para que los solapamientos
 * sigan siendo comparaciones directas sobre un índice. Las reservas que ya
 * existen se rellenan con su propio `end_at`: nacieron sin franja de aseo y su
 * ocupación no cambia.
 *
 * Va aparte de `CreateAmenities` porque esa migración ya corrió sobre datos del
 * usuario.
 */
export class AmenityCleaningWindow1781005700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenities"
        ADD COLUMN IF NOT EXISTS "cleaning_service_available" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "default_cleaning_minutes" int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "cleaning_fee_amount" numeric(12,2) NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        ADD COLUMN IF NOT EXISTS "cleaning_minutes" int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "cleaning_by_complex" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "cleaning_fee_amount" numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "cleaning_charge_id" uuid,
        ADD COLUMN IF NOT EXISTS "cleaning_updated_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "cleaning_updated_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "blocked_until_at" timestamptz
    `);

    // Las reservas existentes ocupan exactamente lo que reservaron.
    await queryRunner.query(`
      UPDATE "amenity_bookings"
         SET "blocked_until_at" = "end_at"
       WHERE "blocked_until_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        ALTER COLUMN "blocked_until_at" SET NOT NULL
    `);

    // El índice caliente del motor de disponibilidad pasa a medir la ocupación
    // real. El anterior queda sin uso.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_bookings_amenity_start_blocked"
        ON "amenity_bookings" ("amenity_id", "start_at", "blocked_until_at")
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
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'AMENITY_CLEANING_UPDATED'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_amenity_bookings_amenity_start_blocked"
    `);

    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        DROP COLUMN IF EXISTS "cleaning_minutes",
        DROP COLUMN IF EXISTS "cleaning_by_complex",
        DROP COLUMN IF EXISTS "cleaning_fee_amount",
        DROP COLUMN IF EXISTS "cleaning_charge_id",
        DROP COLUMN IF EXISTS "cleaning_updated_at",
        DROP COLUMN IF EXISTS "cleaning_updated_by_user_id",
        DROP COLUMN IF EXISTS "blocked_until_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "amenities"
        DROP COLUMN IF EXISTS "cleaning_service_available",
        DROP COLUMN IF EXISTS "default_cleaning_minutes",
        DROP COLUMN IF EXISTS "cleaning_fee_amount"
    `);

    // Postgres no soporta DROP VALUE en un enum; agregar labels no es destructivo.
  }
}
