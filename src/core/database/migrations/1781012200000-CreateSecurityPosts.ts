import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Porterías del conjunto.
 *
 * - `security_posts`: las porterías con nombre (y teléfono opcional). Un
 *   conjunto sin ninguna sigue como hoy: una sola portería implícita.
 * - `security_post_guards`: en qué portería está cada vigilante ahora.
 * - `call_logs.security_post_id/_name`: portería de cada llamada.
 */
export class CreateSecurityPosts1781012200000 implements MigrationInterface {
  name = 'CreateSecurityPosts1781012200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_posts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "complex_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "phone_number" varchar(30) NULL,
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        "created_by_user_id" uuid NULL,
        "updated_by_user_id" uuid NULL,
        CONSTRAINT "PK_security_posts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_security_posts_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_security_posts_complex_name"
        ON "security_posts" ("complex_id", "name")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_post_guards" (
        "user_id" uuid NOT NULL,
        "complex_id" uuid NOT NULL,
        "security_post_id" uuid NOT NULL,
        "selected_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_post_guards" PRIMARY KEY ("user_id"),
        CONSTRAINT "FK_security_post_guards_post" FOREIGN KEY ("security_post_id")
          REFERENCES "security_posts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_security_post_guards_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_security_post_guards_post"
        ON "security_post_guards" ("security_post_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "call_logs"
        ADD COLUMN IF NOT EXISTS "security_post_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "security_post_name" varchar(80) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "call_logs"
        DROP COLUMN IF EXISTS "security_post_name",
        DROP COLUMN IF EXISTS "security_post_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_post_guards"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_posts"`);
  }
}
