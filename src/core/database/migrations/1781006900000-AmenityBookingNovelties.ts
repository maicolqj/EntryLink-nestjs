import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Novedades de portería sobre una reserva de zona común.
 *
 * - `amenity_booking_novelties`: lo que el guarda encuentra al recibir la zona
 *   (o durante el uso): relato, si hay daño y fotos con su SHA-256. Es la
 *   evidencia con la que la administración decide el cobro por daños; sin ella
 *   el cobro es la palabra de la oficina contra la del residente.
 * - `amenity_bookings.checked_out_by_user_id`: quién registró la salida. El
 *   ingreso ya guardaba su autor y la salida no.
 * - Label AMENITY_BOOKING_NOVELTY en los enums nativos de notificaciones: el
 *   aviso a la administración cuando portería registra una novedad.
 */
export class AmenityBookingNovelties1781006900000 implements MigrationInterface {
  name = 'AmenityBookingNovelties1781006900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const rows = (await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      )) as Array<{ exists: boolean }>;
      if (!rows[0]?.exists) continue;

      await queryRunner.query(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'AMENITY_BOOKING_NOVELTY'`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        ADD COLUMN IF NOT EXISTS "checked_out_by_user_id" uuid
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "amenity_booking_novelties" (
        "id"                  uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "booking_id"          uuid         NOT NULL,
        "complex_id"          uuid         NOT NULL,
        "description"         text         NOT NULL,
        "has_damage"          boolean      NOT NULL DEFAULT false,
        "photo_urls"          text[]       DEFAULT '{}',
        "photo_hashes"        text[]       DEFAULT '{}',
        "reported_by_user_id" uuid,
        "reported_by_name"    varchar(180),
        "reported_by_role"    varchar(50),
        "created_at"          timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_amenity_booking_novelties_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_amenity_booking_novelties_booking"
          FOREIGN KEY ("booking_id") REFERENCES "amenity_bookings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_amenity_booking_novelties_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_booking_novelties_booking"
        ON "amenity_booking_novelties" ("booking_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // El label del enum no se revierte: Postgres no permite quitar valores de un
    // enum, y dejarlo de más es inocuo.
    await queryRunner.query(`DROP TABLE IF EXISTS "amenity_booking_novelties"`);
    await queryRunner.query(`
      ALTER TABLE "amenity_bookings" DROP COLUMN IF EXISTS "checked_out_by_user_id"
    `);
  }
}
