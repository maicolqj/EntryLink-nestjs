import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separa los descargos de la unidad de las observaciones de la administración.
 *
 * Las dos se guardan en `pet_incident_statements` —el expediente se lee como
 * un solo hilo—, pero solo los descargos cierran el plazo de defensa. Contar
 * cualquier intervención dejaba sancionar apenas se daba curso con una
 * observación: el caso decía "en plazo" y al reabrirlo ya estaba "listo para
 * resolver", sin que la unidad hubiera dicho nada (Ley 675 art. 59).
 *
 * Lo ya guardado se clasifica por el autor: es descargo si quien lo escribió
 * vive (o vivió) en la unidad señalada.
 */
export class PetIncidentStatementIsDefense1781007100000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pet_incident_statements" ADD COLUMN IF NOT EXISTS "is_defense" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`
      UPDATE "pet_incident_statements" s
         SET "is_defense" = true
        FROM "pet_incidents" i
       WHERE i.id = s.incident_id
         AND s.author_user_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "residents" r
            WHERE r.user_id = s.author_user_id
              AND r.unit_id = i.unit_id
         )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pet_incident_statements" DROP COLUMN IF EXISTS "is_defense"`,
    );
  }
}
