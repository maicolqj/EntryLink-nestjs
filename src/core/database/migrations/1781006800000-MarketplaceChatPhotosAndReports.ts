import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Segunda entrega del chat de clasificados: fotos y reportes.
 *
 * - `marketplace_conversation_reports`: un vecino reporta una conversación.
 *   Es lo ÚNICO que abre el chat a la administración: sin reporte, ningún
 *   moderador lo lee. El índice único parcial deja un solo reporte pendiente
 *   por persona y conversación; resuelto, puede volver a reportar.
 * - `marketplace_conversations.moderation_closed_at`: la administración cerró
 *   la conversación al aceptar un reporte. Queda de solo lectura para los dos.
 * - Labels MARKETPLACE_CHAT_REPORTED (a la administración) y
 *   MARKETPLACE_CHAT_REPORT_RESOLVED (a quien reportó) en los enums nativos de
 *   notificaciones.
 *
 * Las fotos no necesitan columnas: son mensajes con `kind = 'IMAGE'` cuyo
 * `body` guarda la llave del archivo en R2, que nunca sale hacia el cliente.
 */
export class MarketplaceChatPhotosAndReports1781006800000 implements MigrationInterface {
  name = 'MarketplaceChatPhotosAndReports1781006800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const rows = (await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      )) as Array<{ exists: boolean }>;
      if (!rows[0]?.exists) continue;

      for (const label of [
        'MARKETPLACE_CHAT_REPORTED',
        'MARKETPLACE_CHAT_REPORT_RESOLVED',
      ]) {
        await queryRunner.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${label}'`,
        );
      }
    }

    await queryRunner.query(`
      ALTER TABLE "marketplace_conversations"
        ADD COLUMN IF NOT EXISTS "moderation_closed_at" timestamptz
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_conversation_reports" (
        "id"                  uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id"     uuid        NOT NULL,
        "complex_id"          uuid        NOT NULL,
        "reporter_user_id"    uuid        NOT NULL,
        "reported_user_id"    uuid        NOT NULL,
        "reason"              varchar(30) NOT NULL,
        "comment"             text,
        "status"              varchar(20) NOT NULL DEFAULT 'PENDING',
        "resolution_note"     text,
        "resolved_at"         timestamptz,
        "resolved_by_user_id" uuid,
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_conversation_reports_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_conversation_reports_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "marketplace_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_conversation_reports_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_conversation_reports_reporter"
          FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_conversation_reports_reported"
          FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_marketplace_conversation_reports_pending"
        ON "marketplace_conversation_reports" ("conversation_id", "reporter_user_id")
        WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_conversation_reports_complex_status"
        ON "marketplace_conversation_reports" ("complex_id", "status", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "marketplace_conversation_reports"`,
    );
    await queryRunner.query(`
      ALTER TABLE "marketplace_conversations"
        DROP COLUMN IF EXISTS "moderation_closed_at"
    `);
    // Postgres no soporta DROP VALUE en un enum; agregar labels no es destructivo.
  }
}
