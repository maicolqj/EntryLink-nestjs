import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Clasificados y comercio interno.
 *
 * Seis tablas: los ajustes del conjunto (`marketplace_settings`), las
 * categorías de la vitrina (`marketplace_categories`), el aviso
 * (`marketplace_listings`), los reportes de abuso
 * (`marketplace_listing_reports`), los interesados
 * (`marketplace_listing_contacts`) y los favoritos
 * (`marketplace_listing_favorites`).
 *
 * Tres reglas quedan garantizadas por la base y no por el servicio:
 *
 *   · `UQ_marketplace_categories_complex_kind_slug` — el sembrado de categorías
 *     corre cada vez que alguien entra al módulo; sin esta restricción, dos
 *     entradas simultáneas dejarían la vitrina con "Tecnología" dos veces.
 *   · `UQ_marketplace_listing_reports_listing_reporter` — un reporte pendiente
 *     por persona. Con la pausa automática por número de reportes, sin esto un
 *     solo usuario obstinado podría tumbar cualquier aviso.
 *   · `UQ_marketplace_listing_contacts_listing_user` — un "me interesa" por
 *     persona: el contador que ve el publicador no se infla a punta de toques.
 *
 * Corre fuera de transacción porque agrega valores a los enums nativos de
 * notificaciones y de permisos, igual que las migraciones de PQRF, votaciones,
 * mascotas y mantenimiento.
 */
export class CreateMarketplace1781005400000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Ajustes del módulo por complejo ───────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_settings" (
        "complex_id"                   uuid        NOT NULL,
        "moderation_mode"              varchar(10) NOT NULL DEFAULT 'PREVIA',
        "listing_duration_days"        int         NOT NULL DEFAULT 30,
        "max_active_listings_per_unit" int         NOT NULL DEFAULT 5,
        "max_images_per_listing"       int         NOT NULL DEFAULT 5,
        "auto_pause_after_reports"     int         NOT NULL DEFAULT 3,
        "allow_phone_contact"          boolean     NOT NULL DEFAULT true,
        "allow_wanted_listings"        boolean     NOT NULL DEFAULT true,
        "terms_text"                   text,
        "updated_by_user_id"           uuid,
        "created_at"                   timestamptz NOT NULL DEFAULT now(),
        "updated_at"                   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_settings_complex" PRIMARY KEY ("complex_id"),
        CONSTRAINT "FK_marketplace_settings_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);

    // ── Categorías de la vitrina ──────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_categories" (
        "id"                 uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "kind"               varchar(20) NOT NULL DEFAULT 'CLASSIFIED',
        "name"               varchar(80) NOT NULL,
        "slug"               varchar(80) NOT NULL,
        "icon"               varchar(60),
        "sort_order"         smallint    NOT NULL DEFAULT 0,
        "is_active"          boolean     NOT NULL DEFAULT true,
        "complex_id"         uuid        NOT NULL,
        "created_by_user_id" uuid,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        "deleted_at"         timestamptz,
        CONSTRAINT "PK_marketplace_categories_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_categories_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_categories_complex_kind_active"
        ON "marketplace_categories" ("complex_id", "kind", "is_active")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_marketplace_categories_complex_kind_slug"
        ON "marketplace_categories" ("complex_id", "kind", "slug")
        WHERE "deleted_at" IS NULL
    `);

    // ── Publicaciones ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_listings" (
        "id"                    uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "type"                  varchar(20)   NOT NULL,
        "title"                 varchar(120)  NOT NULL,
        "description"           text          NOT NULL,
        "category_id"           uuid          NOT NULL,
        "condition"             varchar(20),
        "image_urls"            text[]        NOT NULL DEFAULT '{}',
        "price_amount"          numeric(14,2),
        "price_type"            varchar(20)   NOT NULL DEFAULT 'FIXED',
        "currency"              varchar(3)    NOT NULL DEFAULT 'COP',
        "contact_preference"    varchar(20)   NOT NULL DEFAULT 'IN_APP',
        "show_phone"            boolean       NOT NULL DEFAULT false,
        "status"                varchar(20)   NOT NULL DEFAULT 'DRAFT',
        "rejection_reason"      text,
        "moderated_by_user_id"  uuid,
        "moderated_at"          timestamptz,
        "accepted_terms_at"     timestamptz,
        "published_at"          timestamptz,
        "expires_at"            timestamptz,
        "renewed_at"            timestamptz,
        "sold_at"               timestamptz,
        "expiry_notified_at"    timestamptz,
        "views_count"           int           NOT NULL DEFAULT 0,
        "contacts_count"        int           NOT NULL DEFAULT 0,
        "favorites_count"       int           NOT NULL DEFAULT 0,
        "pending_reports_count" int           NOT NULL DEFAULT 0,
        "owner_user_id"         uuid          NOT NULL,
        "resident_id"           uuid,
        "unit_id"               uuid          NOT NULL,
        "complex_id"            uuid          NOT NULL,
        "updated_by_user_id"    uuid,
        "created_at"            timestamptz   NOT NULL DEFAULT now(),
        "updated_at"            timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"            timestamptz,
        CONSTRAINT "PK_marketplace_listings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_listings_category"
          FOREIGN KEY ("category_id") REFERENCES "marketplace_categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_marketplace_listings_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_listings_unit"
          FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_listings_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listings_complex_status_published"
        ON "marketplace_listings" ("complex_id", "status", "published_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listings_complex_category_status"
        ON "marketplace_listings" ("complex_id", "category_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listings_owner"
        ON "marketplace_listings" ("owner_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listings_unit"
        ON "marketplace_listings" ("unit_id")
    `);
    // El cron de caducidad barre por estado y vencimiento, sin filtrar complejo.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listings_status_expires"
        ON "marketplace_listings" ("status", "expires_at")
    `);

    // ── Reportes de abuso ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_listing_reports" (
        "id"                  uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "listing_id"          uuid        NOT NULL,
        "reason"              varchar(30) NOT NULL,
        "comment"             text,
        "status"              varchar(20) NOT NULL DEFAULT 'PENDING',
        "reporter_user_id"    uuid,
        "reporter_unit_id"    uuid,
        "resolved_by_user_id" uuid,
        "resolved_at"         timestamptz,
        "resolution_note"     text,
        "complex_id"          uuid        NOT NULL,
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        "updated_at"          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_listing_reports_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_listing_reports_listing"
          FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_listing_reports_reporter"
          FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_marketplace_listing_reports_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listing_reports_listing_status"
        ON "marketplace_listing_reports" ("listing_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listing_reports_complex_status_created"
        ON "marketplace_listing_reports" ("complex_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_marketplace_listing_reports_listing_reporter"
        ON "marketplace_listing_reports" ("listing_id", "reporter_user_id")
        WHERE "status" = 'PENDING' AND "reporter_user_id" IS NOT NULL
    `);

    // ── Interesados ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_listing_contacts" (
        "id"                 uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "listing_id"         uuid        NOT NULL,
        "interested_user_id" uuid        NOT NULL,
        "interested_unit_id" uuid,
        "channel"            varchar(20) NOT NULL DEFAULT 'IN_APP',
        "message"            text,
        "complex_id"         uuid        NOT NULL,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_listing_contacts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_marketplace_listing_contacts_listing_user"
          UNIQUE ("listing_id", "interested_user_id"),
        CONSTRAINT "FK_marketplace_listing_contacts_listing"
          FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_listing_contacts_user"
          FOREIGN KEY ("interested_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_listing_contacts_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listing_contacts_listing_created"
        ON "marketplace_listing_contacts" ("listing_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listing_contacts_complex_created"
        ON "marketplace_listing_contacts" ("complex_id", "created_at")
    `);

    // ── Favoritos ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_listing_favorites" (
        "id"         uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "listing_id" uuid        NOT NULL,
        "user_id"    uuid        NOT NULL,
        "complex_id" uuid        NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_listing_favorites_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_marketplace_listing_favorites_listing_user"
          UNIQUE ("listing_id", "user_id"),
        CONSTRAINT "FK_marketplace_listing_favorites_listing"
          FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_listing_favorites_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_listing_favorites_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_listing_favorites_user_created"
        ON "marketplace_listing_favorites" ("user_id", "created_at")
    `);

    // ── Tipos de notificación ─────────────────────────────────────────────
    // Sin estos labels el INSERT del aviso falla, y como notify() va
    // fire-and-forget el error se traga en silencio: el vecino nunca se entera
    // de que le aprobaron —o le tumbaron— la publicación.
    const notificationTypes = [
      'LISTING_PENDING_REVIEW',
      'LISTING_APPROVED',
      'LISTING_REJECTED',
      'LISTING_INTEREST',
      'LISTING_REPORTED',
      'LISTING_PAUSED_BY_REPORTS',
      'LISTING_EXPIRING',
      'LISTING_EXPIRED',
    ];

    for (const type of notificationTypes) {
      await queryRunner.query(
        `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS '${type}'`,
      );
      await queryRunner.query(
        `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS '${type}'`,
      );
    }

    // ── Escenario de acción del aviso ─────────────────────────────────────
    // `notifications.actionType` también es un enum nativo, pero lo creó
    // `synchronize` en su día y no una migración: el nombre del tipo no está
    // escrito en ninguna parte del repo. Se pregunta en vez de adivinarlo.
    const [actionEnum] = (await queryRunner.query(`
      SELECT t.typname AS name
        FROM pg_type t
        JOIN pg_attribute a ON a.atttypid = t.oid
        JOIN pg_class c     ON c.oid = a.attrelid
       WHERE c.relname = 'notifications'
         AND a.attname IN ('actionType', 'action_type')
         AND t.typtype = 'e'
       LIMIT 1
    `)) as Array<{ name: string }>;

    if (actionEnum?.name) {
      await queryRunner.query(
        `ALTER TYPE "${actionEnum.name}" ADD VALUE IF NOT EXISTS 'LISTING_APPROVAL'`,
      );
    }

    // ── Permisos ──────────────────────────────────────────────────────────
    // `permissions.name` es un enum NATIVO: sin estos labels el seed falla con
    // "invalid input value for enum permissions_name_enum".
    const permissions = [
      'VIEW_MARKETPLACE',
      'PUBLISH_LISTING',
      'MODERATE_LISTINGS',
      'MANAGE_LISTING_REPORTS',
      'MANAGE_MARKETPLACE_SETTINGS',
    ];

    for (const value of permissions) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "marketplace_listing_favorites"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "marketplace_listing_contacts"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "marketplace_listing_reports"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_listings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_categories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_settings"`);
    // Los labels de los enums no se revierten: Postgres no permite quitarlos.
  }
}
