import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Excepciones de horario por fecha para las zonas comunes.
 *
 * El horario semanal cubre la regla ("los sábados de 12:00 a 05:00") y no hay
 * que recargarlo nunca. Lo que no puede expresar es la fecha suelta: el festivo
 * en que el salón se presta hasta la madrugada del lunes, o el día en que no se
 * presta. Esta tabla es esa excepción y REEMPLAZA al horario semanal en su
 * fecha; no se suma a él.
 *
 * Una fila por (zona, fecha) — de ahí el índice único: dos reglas distintas
 * para el mismo día serían ambiguas.
 */
export class CreateAmenityScheduleExceptions1781003900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "amenity_schedule_exceptions" (
        "id"                 uuid         NOT NULL DEFAULT gen_random_uuid(),
        "amenity_id"         uuid         NOT NULL,
        "complex_id"         uuid         NOT NULL,
        "date"               date         NOT NULL,
        "is_closed"          boolean      NOT NULL DEFAULT false,
        "open_time"          time,
        "close_time"         time,
        "reason"             varchar(200),
        "created_by_user_id" uuid,
        "created_at"         timestamptz  NOT NULL DEFAULT now(),
        "updated_at"         timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_amenity_schedule_exceptions_id" PRIMARY KEY ("id"),
        -- O la zona cierra ese día, o hay una ventana completa. Media ventana
        -- (solo apertura, o solo cierre) no significa nada.
        CONSTRAINT "CHK_amenity_schedule_exceptions_shape" CHECK (
          ("is_closed" = true  AND "open_time" IS NULL AND "close_time" IS NULL) OR
          ("is_closed" = false AND "open_time" IS NOT NULL AND "close_time" IS NOT NULL)
        ),
        CONSTRAINT "FK_amenity_schedule_exceptions_amenity"
          FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_amenity_schedule_exceptions_amenity_date"
        ON "amenity_schedule_exceptions" ("amenity_id", "date")
    `);

    // El calendario del admin y el motor de disponibilidad piden siempre un mes
    // de un complejo; sin este índice es un scan por fecha.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_amenity_schedule_exceptions_complex_date"
        ON "amenity_schedule_exceptions" ("complex_id", "date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "amenity_schedule_exceptions"`,
    );
  }
}
