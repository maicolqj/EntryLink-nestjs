import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Mi Conjunto": documentos del conjunto (con acuse de lectura por versión) y
 * directorio de contactos.
 *
 * El PDF de cada documento se guarda por su llave de R2 (`file_key`), nunca
 * por URL pública: el backend lo sirve tras validar quién lo pide.
 */
export class CreateComplexInfo1781007600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "complex_document_category" AS ENUM (
          'COEXISTENCE_MANUAL', 'BYLAWS', 'COMMON_AREA_RULES', 'CIRCULARS',
          'ASSEMBLY_MINUTES', 'FINANCIAL_REPORTS', 'INSURANCE', 'FORMS', 'OTHER'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "complex_document_audience" AS ENUM ('ALL_RESIDENTS', 'OWNERS_ONLY');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "complex_contact_category" AS ENUM (
          'ADMINISTRATION', 'SECURITY', 'COUNCIL', 'MAINTENANCE',
          'EMERGENCY', 'SERVICE', 'OTHER'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "complex_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "category" "complex_document_category" NOT NULL,
        "title" varchar(200) NOT NULL,
        "description" text,
        "content_html" text,
        "file_key" text,
        "file_name" varchar(255),
        "file_size" int,
        "audience" "complex_document_audience" NOT NULL DEFAULT 'ALL_RESIDENTS',
        "is_published" boolean NOT NULL DEFAULT false,
        "published_at" TIMESTAMPTZ,
        "is_pinned" boolean NOT NULL DEFAULT false,
        "requires_acknowledgement" boolean NOT NULL DEFAULT false,
        "effective_date" date,
        "version" int NOT NULL DEFAULT 1,
        "content_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_complex_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_complex_documents_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_complex_documents_complex_published" ON "complex_documents" ("complex_id", "is_published")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "complex_document_acks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "document_id" uuid NOT NULL,
        "version" int NOT NULL,
        "user_id" uuid NOT NULL,
        "unit_id" uuid NOT NULL,
        "acknowledged_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_complex_document_acks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_complex_document_acks_document" FOREIGN KEY ("document_id")
          REFERENCES "complex_documents"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_complex_document_acks_doc_version_user"
        ON "complex_document_acks" ("document_id", "version", "user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "complex_contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "category" "complex_contact_category" NOT NULL,
        "name" varchar(150) NOT NULL,
        "role" varchar(150),
        "phone" varchar(30),
        "email" varchar(150),
        "schedule" varchar(200),
        "notes" text,
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_complex_contacts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_complex_contacts_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_complex_contacts_complex" ON "complex_contacts" ("complex_id")`,
    );

    // Sin estos labels el aviso de "documento publicado" se pierde en el
    // INSERT, que va fire-and-forget.
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'COMPLEX_DOCUMENT_PUBLISHED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS 'COMPLEX_DOCUMENT_PUBLISHED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "complex_document_acks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "complex_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "complex_contacts"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "complex_document_category"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "complex_document_audience"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "complex_contact_category"`);
  }
}
