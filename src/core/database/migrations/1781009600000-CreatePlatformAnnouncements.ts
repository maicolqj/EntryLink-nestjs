import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comunicados de la plataforma a los conjuntos (novedades, promociones,
 * noticias) y el tipo de notificación con el que llegan.
 *
 * Cada destinatario recibe una notificación PLATFORM_ANNOUNCEMENT que apunta a
 * esta tabla; las imágenes viven aquí y se muestran al abrir el detalle.
 */
export class CreatePlatformAnnouncements1781009600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_announcements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "category" varchar(20) NOT NULL,
        "title" varchar(150) NOT NULL,
        "body" text NOT NULL,
        "image_urls" jsonb NOT NULL DEFAULT '[]',
        "audience" varchar(20) NOT NULL,
        "target_mode" varchar(20) NOT NULL,
        "complex_ids" jsonb NOT NULL DEFAULT '[]',
        "target_plans" jsonb NOT NULL DEFAULT '[]',
        "target_statuses" jsonb NOT NULL DEFAULT '[]',
        "target_engagements" jsonb NOT NULL DEFAULT '[]',
        "status" varchar(20) NOT NULL DEFAULT 'SENDING',
        "complexes_count" int NOT NULL DEFAULT 0,
        "recipients_count" int NOT NULL DEFAULT 0,
        "sent_at" timestamptz,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_announcements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_platform_announcements_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_platform_announcements_created_at"
        ON "platform_announcements" ("created_at")
    `);

    // Tipo de notificación nuevo. Se agrega sin usarse en esta transacción.
    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const rows = (await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      )) as { exists: boolean }[];
      if (!rows[0]?.exists) continue;

      await queryRunner.query(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'PLATFORM_ANNOUNCEMENT'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // El valor del enum de notificaciones no se puede quitar en Postgres.
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_announcements"`);
  }
}
