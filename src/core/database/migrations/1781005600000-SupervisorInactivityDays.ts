import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plazo de inactividad de los supervisores, por complejo.
 *
 * El cron que retira a un supervisor sin check-in usaba 30 días fijos. Cada
 * administración sabe cada cuánto la visitan, así que el plazo pasa a ser del
 * complejo. El valor por defecto conserva el comportamiento anterior.
 */
export class SupervisorInactivityDays1781005600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "supervisor_inactivity_days" int NOT NULL DEFAULT 30
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "supervisor_inactivity_days"
    `);
  }
}
