import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat entre quien publica un aviso y quien se interesó.
 *
 * - `marketplace_conversations`: una por aviso e interesado (índice único). Los
 *   contadores de no leídos y el último mensaje viven en la fila para que la
 *   bandeja se arme con una sola consulta.
 * - `marketplace_messages`: los mensajes. Índice por conversación y fecha, que
 *   es como se leen (del más nuevo hacia atrás).
 * - `marketplace_user_blocks`: quién bloqueó a quién. Bloquear corta los
 *   mensajes en las dos direcciones.
 *
 * La administración no lee estas tablas desde la plataforma: el chat es entre
 * los dos vecinos.
 *
 * Agrega además el label MARKETPLACE_CHAT_MESSAGE a los enums nativos de
 * notificaciones. Los mensajes salen solo como push (no llenan la bandeja),
 * pero el tipo existe en el enum y cualquier INSERT futuro fallaría sin él.
 */
export class CreateMarketplaceChat1781006700000 implements MigrationInterface {
  name = 'CreateMarketplaceChat1781006700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of [
      'notifications_type_enum',
      'notification_batches_type_enum',
    ]) {
      const [{ exists }] = await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') AS exists`,
      );
      if (!exists) continue;

      await queryRunner.query(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'MARKETPLACE_CHAT_MESSAGE'`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_conversations" (
        "id"                        uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "listing_id"                uuid         NOT NULL,
        "complex_id"                uuid         NOT NULL,
        "owner_user_id"             uuid         NOT NULL,
        "interested_user_id"        uuid         NOT NULL,
        "interested_unit_id"        uuid,
        "last_message_at"           timestamptz,
        "last_message_preview"      varchar(200),
        "last_message_sender_id"    uuid,
        "owner_unread_count"        integer      NOT NULL DEFAULT 0,
        "interested_unread_count"   integer      NOT NULL DEFAULT 0,
        "owner_last_read_at"        timestamptz,
        "interested_last_read_at"   timestamptz,
        "owner_phone_shared_at"     timestamptz,
        "interested_phone_shared_at" timestamptz,
        "created_at"                timestamptz  NOT NULL DEFAULT now(),
        "updated_at"                timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_conversations_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_marketplace_conversations_listing_interested"
          UNIQUE ("listing_id", "interested_user_id"),
        CONSTRAINT "FK_marketplace_conversations_listing"
          FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_conversations_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_conversations_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_conversations_interested"
          FOREIGN KEY ("interested_user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_conversations_owner_last"
        ON "marketplace_conversations" ("owner_user_id", "last_message_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_conversations_interested_last"
        ON "marketplace_conversations" ("interested_user_id", "last_message_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_messages" (
        "id"               uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id"  uuid        NOT NULL,
        "sender_user_id"   uuid        NOT NULL,
        "kind"             varchar(20) NOT NULL DEFAULT 'TEXT',
        "body"             text        NOT NULL,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_messages_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "marketplace_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_messages_sender"
          FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_messages_conversation_created"
        ON "marketplace_messages" ("conversation_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_user_blocks" (
        "id"               uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "blocker_user_id"  uuid        NOT NULL,
        "blocked_user_id"  uuid        NOT NULL,
        "complex_id"       uuid        NOT NULL,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_user_blocks_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_marketplace_user_blocks_pair"
          UNIQUE ("blocker_user_id", "blocked_user_id"),
        CONSTRAINT "FK_marketplace_user_blocks_blocker"
          FOREIGN KEY ("blocker_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_user_blocks_blocked"
          FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_user_blocks_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_user_blocks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_conversations"`);
  }
}
