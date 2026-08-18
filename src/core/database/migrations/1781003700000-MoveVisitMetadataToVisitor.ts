import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los datos que portería lee del documento (fecha y lugar de nacimiento,
 * nacionalidad, estatura, expedición…) se venían guardando en `visits.metadata`.
 * Describen a la persona, no a una visita concreta: se duplicaban en cada
 * entrada y el registro del visitante quedaba siempre vacío.
 *
 * Esta migración prepara su nuevo sitio:
 *  1. Garantiza que exista `visitors.metadata`. El proyecto corre con
 *     `synchronize: false` y ninguna migración anterior la creó, así que en la
 *     BD desplegada puede no estar — y sin ella el registro de visitas fallaría
 *     al guardar el visitante.
 *  2. Traslada lo ya guardado, tomando la visita más reciente de cada visitante
 *     que traiga metadata. Sólo rellena visitantes que aún no tengan nada, de
 *     modo que reejecutarla no pisa datos nuevos.
 *
 * `visits.metadata` se deja intacta: ya no se escribe, pero conserva el
 * histórico. Eliminar esa columna es una decisión aparte y destructiva.
 */
export class MoveVisitMetadataToVisitor1781003700000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "visitors"
      ADD COLUMN IF NOT EXISTS "metadata" jsonb
    `);

    // La columna de origen puede no existir en instalaciones donde nunca se
    // creó; sin esta guarda el backfill tumbaría la migración.
    const [{ exists }] = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'visits' AND column_name = 'metadata'
      ) AS "exists"
    `);
    if (!exists) return;

    await queryRunner.query(`
      UPDATE "visitors" v
      SET "metadata" = latest."metadata"
      FROM (
        SELECT DISTINCT ON (vi."visitor_id")
               vi."visitor_id" AS visitor_id,
               vi."metadata"   AS metadata
        FROM "visits" vi
        WHERE vi."metadata" IS NOT NULL
        ORDER BY vi."visitor_id", vi."created_at" DESC
      ) AS latest
      WHERE v."id" = latest.visitor_id
        AND v."metadata" IS NULL
    `);
  }

  /**
   * No borra `visitors.metadata`: la columna pudo existir antes de esta
   * migración y llevar datos que no vinieron del traslado. Revertir sólo deshace
   * lo que este `up` rellenó sería adivinar, así que se deja como está.
   */
  public async down(): Promise<void> {
    // Sin operación deliberadamente.
  }
}
