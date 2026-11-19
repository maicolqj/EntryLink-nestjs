import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comunicados también por correo, con archivos adjuntos.
 *
 * - `channels`: NOTIFICATION y/o EMAIL. Los ya enviados fueron solo aviso.
 * - `attachments`: [{ key, name, mimeType, size }]. La llave de R2 nunca sale
 *   al cliente; el backend sirve el archivo a quien recibió el comunicado.
 * - `emails_count`: correos puestos en la cola.
 */
export class AddEmailToPlatformAnnouncements1781009700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_announcements"
        ADD COLUMN IF NOT EXISTS "channels" jsonb NOT NULL DEFAULT '["NOTIFICATION"]',
        ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS "emails_count" int NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_announcements"
        DROP COLUMN IF EXISTS "emails_count",
        DROP COLUMN IF EXISTS "attachments",
        DROP COLUMN IF EXISTS "channels"
    `);
  }
}
