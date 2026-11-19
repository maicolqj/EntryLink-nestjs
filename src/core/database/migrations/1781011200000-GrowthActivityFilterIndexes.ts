import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, entrega 1E-0: índices para filtrar la actividad por tipo de
 * acción y por periodo sin recorrer la tabla. Solo índices: no cambia datos
 * ni el trigger append-only.
 *
 *  - `(action, created_at DESC)`: filtro por acción, ya ordenado.
 *  - `(created_at DESC)`: periodo sin otro filtro, y el listado general.
 *
 * La tabla es chica en esta etapa; `CREATE INDEX` normal (no CONCURRENTLY)
 * porque las migraciones corren dentro de una transacción.
 */
export class GrowthActivityFilterIndexes1781011200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_growth_activity_action ON growth.activity_events (action, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_growth_activity_created ON growth.activity_events (created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS growth.ix_growth_activity_created`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS growth.ix_growth_activity_action`,
    );
  }
}
