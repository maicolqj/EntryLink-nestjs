import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * vehicleTypes en recurring_charges: tipos de vehículo a los que aplica un cargo
 * triggerType=VEHICLE (ej. "Parqueadero carros" → CAR,VAN,TRUCK). Null = todos.
 * Evita que un cargo de carros se aplique a motos y viceversa. Idempotente.
 */
export class AddVehicleTypesToRecurringCharges1781001000000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recurring_charges"
      ADD COLUMN IF NOT EXISTS "vehicleTypes" varchar[]
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recurring_charges" DROP COLUMN IF EXISTS "vehicleTypes"`);
  }
}
