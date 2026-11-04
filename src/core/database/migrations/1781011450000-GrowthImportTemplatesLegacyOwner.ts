import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Compatibilidad hacia atrás de las plantillas de importación.
 *
 * Si se vuelve a la imagen anterior sin revertir 1781011400000, el código
 * viejo inserta plantillas sin `owner_user_id` (que ahora es NOT NULL) y el
 * guardado del mapeo haría fallar la importación completa. Este trigger
 * completa una fila así como lo que el código viejo entendía: una plantilla
 * del equipo cuyo dueño es su autor (lo mismo que hizo la migración con las
 * que ya existían). El código nuevo siempre manda el dueño y no lo dispara.
 */
export class GrowthImportTemplatesLegacyOwner1781011450000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION growth.import_tpl_legacy_owner() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.owner_user_id IS NULL THEN
          NEW.owner_user_id := NEW.created_by_user_id;
          NEW.scope := 'TEAM';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`
      CREATE TRIGGER trg_growth_import_tpl_legacy_owner
        BEFORE INSERT ON growth.import_mapping_templates
        FOR EACH ROW EXECUTE FUNCTION growth.import_tpl_legacy_owner()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TRIGGER IF EXISTS trg_growth_import_tpl_legacy_owner ON growth.import_mapping_templates`,
    );
    await q.query(`DROP FUNCTION IF EXISTS growth.import_tpl_legacy_owner()`);
  }
}
