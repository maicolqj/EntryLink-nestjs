import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permite horarios de zona común que cruzan la medianoche.
 *
 * `CHK_amenity_schedules_range` exigía `close_time > open_time`, lo que dejaba
 * fuera el caso más común del salón comunal: se presta el sábado desde el
 * mediodía hasta el domingo a las 5 a. m. Con la restricción no había forma de
 * expresarlo, y partir la franja en dos (sábado 12:00–23:59 + domingo
 * 00:00–05:00) no sirve: son dos ventanas distintas, así que una reserva no
 * puede abarcarlas y el residente tendría que hacer dos.
 *
 * A partir de aquí, una hora de cierre menor o igual a la de apertura significa
 * que la franja termina al día siguiente. La coherencia (que no dure más de
 * 24 h, que no se solape con otra franja ni invada la apertura del día
 * siguiente) la valida el servicio, que sí tiene el contexto de la semana
 * completa.
 *
 * Va como migración aparte y no editando la que creó la tabla porque ya hay
 * zonas y horarios cargados: recrear la tabla los borraría.
 */
export class AllowOvernightAmenitySchedules1781003800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "amenity_schedules"
      DROP CONSTRAINT IF EXISTS "CHK_amenity_schedules_range"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Al restaurar la restricción se quedarían fuera las franjas nocturnas que
    // se hayan creado mientras tanto, así que primero se eliminan.
    await queryRunner.query(`
      DELETE FROM "amenity_schedules" WHERE "close_time" <= "open_time"
    `);
    await queryRunner.query(`
      ALTER TABLE "amenity_schedules"
      ADD CONSTRAINT "CHK_amenity_schedules_range" CHECK ("close_time" > "open_time")
    `);
  }
}
