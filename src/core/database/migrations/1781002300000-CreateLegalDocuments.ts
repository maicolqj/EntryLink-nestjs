import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea la tabla "legal_documents" y siembra los 3 documentos base
 * (sin contenido, no publicados). El SUPER_ADMIN sube el .docx de cada uno
 * desde el panel /dashboard/legal para poblar el HTML y publicarlos.
 *
 * Idempotente (IF NOT EXISTS) por si en dev se corrió `synchronize`.
 */
export class CreateLegalDocuments1781002300000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "legal_documents" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug"          varchar(120) NOT NULL,
        "title"         varchar(200) NOT NULL,
        "description"   text,
        "content_html"  text,
        "is_published"  boolean NOT NULL DEFAULT false,
        "version"       int NOT NULL DEFAULT 1,
        "updated_by_id" uuid,
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_legal_documents_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_legal_documents_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "legal_documents" ("slug", "title", "description")
      VALUES
        ('terminos-y-condiciones', 'Términos y Condiciones',
         'Condiciones de uso de la plataforma EntryLink para la gestión de complejos residenciales.'),
        ('politica-de-privacidad', 'Política de Privacidad',
         'Cómo recolectamos, usamos y protegemos los datos personales de los usuarios.'),
        ('acuerdo-tratamiento-datos', 'Anexo B2B: Acuerdo de Tratamiento de Datos (DPA)',
         'Acuerdo de tratamiento de datos personales entre EntryLink y los complejos residenciales.')
      ON CONFLICT ("slug") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_documents"`);
  }
}
