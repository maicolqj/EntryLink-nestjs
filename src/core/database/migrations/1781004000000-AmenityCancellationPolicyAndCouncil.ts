import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Política de cancelación en horas, penalización parcial y cupo del consejo.
 *
 * Tres cosas que el reglamento de las copropiedades ya contemplaba y el modelo
 * no:
 *
 * 1. El plazo de cancelación se escribe en horas ("48 horas antes"), no solo en
 *    días. La columna nueva se SUMA a `cancellation_deadline_days` en vez de
 *    reemplazarla, así ninguna zona ya configurada cambia de comportamiento.
 * 2. Cancelar tarde no siempre cuesta el 100%: `late_cancellation_fee_percent`
 *    nace en 100 justamente para no alterar lo que hoy hacen las zonas
 *    existentes, y el administrador lo baja si su reglamento retiene menos.
 * 3. Algunos complejos le dan al consejo de administración una reserva gratis
 *    al año. Es opcional por zona (`council_free_bookings_per_year`, 0 = sin
 *    beneficio) y la marca de quién pertenece al consejo vive en el residente,
 *    no en un rol: el consejo se renueva y entra a la app como cualquiera.
 *
 * Va aparte y no editando las migraciones de zonas comunes porque esas tablas
 * ya tienen datos del usuario.
 */
export class AmenityCancellationPolicyAndCouncil1781004000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenities"
        ADD COLUMN IF NOT EXISTS "cancellation_deadline_hours"    int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "late_cancellation_fee_percent"  int NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS "council_free_bookings_per_year" int NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "amenities"
        ADD CONSTRAINT "CHK_amenities_late_cancellation_percent"
        CHECK ("late_cancellation_fee_percent" BETWEEN 0 AND 100)
    `);

    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        ADD COLUMN IF NOT EXISTS "is_council_free_booking"     boolean       NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "late_cancellation_amount"    numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "late_cancellation_charge_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "residents"
        ADD COLUMN IF NOT EXISTS "is_council_member" boolean NOT NULL DEFAULT false
    `);

    // El cupo se cuenta por persona y año sobre las reservas ya marcadas, así
    // que ese conteo se hace por residente y por fecha de inicio.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_bookings_council_free"
        ON "amenity_bookings" ("requested_by_user_id", "start_at")
        WHERE "is_council_free_booking" = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_residents_council_member"
        ON "residents" ("complex_id")
        WHERE "is_council_member" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_residents_council_member"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_amenity_bookings_council_free"`,
    );

    await queryRunner.query(
      `ALTER TABLE "residents" DROP COLUMN IF EXISTS "is_council_member"`,
    );

    await queryRunner.query(`
      ALTER TABLE "amenity_bookings"
        DROP COLUMN IF EXISTS "late_cancellation_charge_id",
        DROP COLUMN IF EXISTS "late_cancellation_amount",
        DROP COLUMN IF EXISTS "is_council_free_booking"
    `);

    await queryRunner.query(`
      ALTER TABLE "amenities" DROP CONSTRAINT IF EXISTS "CHK_amenities_late_cancellation_percent"
    `);

    await queryRunner.query(`
      ALTER TABLE "amenities"
        DROP COLUMN IF EXISTS "council_free_bookings_per_year",
        DROP COLUMN IF EXISTS "late_cancellation_fee_percent",
        DROP COLUMN IF EXISTS "cancellation_deadline_hours"
    `);
  }
}
