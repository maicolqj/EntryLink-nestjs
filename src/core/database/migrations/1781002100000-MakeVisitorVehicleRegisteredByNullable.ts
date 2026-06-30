import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hace `registered_by_user_id` de `visitor_vehicles` NULLABLE y cambia su FK a
 * ON DELETE SET NULL.
 *
 * Motivo: cuando una cuenta de complejo (entityType === 'complex') registra un
 * ingreso, el `sub` del JWT es el UUID del complejo —no existe en `users`— y la
 * FK `FK_bbe6bd772f8efc1fb6e40c48f7a` (registered_by_user_id -> users.id)
 * provocaba un fallo de constraint. Ahora el servicio guarda NULL en ese caso.
 *
 * El proyecto corre con `synchronize: false`. La tabla pudo crearse vía un
 * `synchronize` previo en dev, así que la operación es idempotente.
 */
export class MakeVisitorVehicleRegisteredByNullable1781002100000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar la FK existente (cualquiera sea su nombre conocido)
    await queryRunner.query(`
      ALTER TABLE "visitor_vehicles"
        DROP CONSTRAINT IF EXISTS "FK_bbe6bd772f8efc1fb6e40c48f7a"
    `);

    // 2. Permitir NULL en la columna
    await queryRunner.query(`
      ALTER TABLE "visitor_vehicles"
        ALTER COLUMN "registered_by_user_id" DROP NOT NULL
    `);

    // 3. Recrear la FK con ON DELETE SET NULL
    await queryRunner.query(`
      ALTER TABLE "visitor_vehicles"
        ADD CONSTRAINT "FK_bbe6bd772f8efc1fb6e40c48f7a"
        FOREIGN KEY ("registered_by_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "visitor_vehicles"
        DROP CONSTRAINT IF EXISTS "FK_bbe6bd772f8efc1fb6e40c48f7a"
    `);

    // Revertir a NOT NULL solo si no hay filas con NULL
    await queryRunner.query(`
      ALTER TABLE "visitor_vehicles"
        ALTER COLUMN "registered_by_user_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "visitor_vehicles"
        ADD CONSTRAINT "FK_bbe6bd772f8efc1fb6e40c48f7a"
        FOREIGN KEY ("registered_by_user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }
}
