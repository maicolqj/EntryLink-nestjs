import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El número de radicado pasa de "PQR-000001" a "PQRF-000001".
 *
 * Es el nombre con el que la copropiedad conoce el trámite —PQRF, con la F de
 * felicitaciones— y el número es lo que el residente cita cuando reclama, así
 * que los ya emitidos se renombran también: dos formatos conviviendo obligarían
 * a explicar cuál es cuál.
 */
export class PqrfCodePrefix1781004500000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "pqrf_requests"
         SET "code" = 'PQRF-' || substring("code" from 5)
       WHERE "code" LIKE 'PQR-%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "pqrf_requests"
         SET "code" = 'PQR-' || substring("code" from 6)
       WHERE "code" LIKE 'PQRF-%'
    `);
  }
}
