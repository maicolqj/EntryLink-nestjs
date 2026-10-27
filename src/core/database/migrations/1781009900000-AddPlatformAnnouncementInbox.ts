import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Historial de comunicados como bandeja de correo.
 *
 * - `deleted_at` / `deleted_by_user_id`: papelera. Lo borrado se recupera
 *   durante 30 días; después un cron lo elimina con sus archivos.
 * - `platform_announcement_user_states`: destacado y archivado, personales de
 *   cada miembro de la plataforma.
 */
export class AddPlatformAnnouncementInbox1781009900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_announcements"
        ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "deleted_by_user_id" uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_platform_announcements_deleted_at"
        ON "platform_announcements" ("deleted_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_announcement_user_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "announcement_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "is_starred" boolean NOT NULL DEFAULT false,
        "is_archived" boolean NOT NULL DEFAULT false,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_announcement_user_states" PRIMARY KEY ("id"),
        CONSTRAINT "FK_platform_announcement_user_states_announcement"
          FOREIGN KEY ("announcement_id") REFERENCES "platform_announcements"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_platform_announcement_user_states_pair"
        ON "platform_announcement_user_states" ("announcement_id", "user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_platform_announcement_user_states_user"
        ON "platform_announcement_user_states" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "platform_announcement_user_states"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_platform_announcements_deleted_at"`,
    );
    await queryRunner.query(`
      ALTER TABLE "platform_announcements"
        DROP COLUMN IF EXISTS "deleted_by_user_id",
        DROP COLUMN IF EXISTS "deleted_at"
    `);
  }
}
