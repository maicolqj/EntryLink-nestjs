import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Qué consejeros responden los PQRF dirigidos al consejo.
 *
 * Hasta hoy respondía el consejo completo: el radicado solo se cerraba cuando
 * TODOS sus miembros lo marcaban, y en un consejo de siete personas eso deja
 * radicados abiertos hasta el silencio positivo. La administración elige ahora
 * a quiénes les toca.
 *
 * Arreglo vacío = todo el consejo, que es el comportamiento anterior: los
 * complejos que no configuren nada siguen funcionando igual.
 */
export class PqrfCouncilResolvers1781004600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "pqrf_council_resolver_user_ids" uuid[] NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "pqrf_council_resolver_user_ids"
    `);
  }
}
