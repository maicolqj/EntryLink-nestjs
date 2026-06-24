import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ledger contable de propiedad horizontal (partida doble).
 *
 * Crea: puc_accounts, accounting_headers, accounting_lines,
 * property_account_status, recurring_charges, tenant_financial_configs,
 * document_sequences.
 *
 * Inmutabilidad reforzada en BD con triggers BEFORE UPDATE/DELETE sobre
 * accounting_headers (solo se permite enlazar reversedByHeaderId) y
 * accounting_lines (totalmente inmutable). Columnas en camelCase para
 * coincidir con las entidades TypeORM (el proyecto no usa naming strategy).
 */
export class CreateAccountingLedger1781000000000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Tipos enum nativos ───────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "accounting_document_type_enum" AS ENUM
          ('INVOICE','CASH_RECEIPT','EXPENSE_VOUCHER','ACCOUNTING_NOTE','CREDIT_NOTE');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "account_nature_enum" AS ENUM ('DEBIT','CREDIT');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "account_class_enum" AS ENUM ('1','2','3','4','5','6');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "recurring_charge_type_enum" AS ENUM ('indefinite','deferred','one_time');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "interest_type_enum" AS ENUM ('nominal_monthly','effective_annual');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // ─── puc_accounts ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "puc_accounts" (
        "id"           uuid                       NOT NULL DEFAULT gen_random_uuid(),
        "code"         varchar(20)                NOT NULL,
        "name"         varchar(200)               NOT NULL,
        "accountClass" "account_class_enum"       NOT NULL,
        "nature"       "account_nature_enum"      NOT NULL,
        "isPostable"   boolean                    NOT NULL DEFAULT true,
        "isActive"     boolean                    NOT NULL DEFAULT true,
        "level"        integer                    NOT NULL DEFAULT 1,
        "parentId"     uuid,
        "complexId"    uuid                       NOT NULL,
        "createdAt"    timestamp                  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_puc_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_puc_accounts_complex_code" UNIQUE ("complexId","code"),
        CONSTRAINT "FK_puc_accounts_parent"  FOREIGN KEY ("parentId")  REFERENCES "puc_accounts"("id")          ON DELETE RESTRICT,
        CONSTRAINT "FK_puc_accounts_complex" FOREIGN KEY ("complexId") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_puc_accounts_postable" ON "puc_accounts" ("complexId","isPostable")`);

    // ─── accounting_headers ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "accounting_headers" (
        "id"                 uuid                            NOT NULL DEFAULT gen_random_uuid(),
        "documentType"       "accounting_document_type_enum" NOT NULL,
        "consecutive"        integer                         NOT NULL,
        "documentDate"       date                            NOT NULL,
        "period"             varchar(7)                      NOT NULL,
        "memo"               text,
        "totalDebit"         numeric(18,2)                   NOT NULL,
        "totalCredit"        numeric(18,2)                   NOT NULL,
        "thirdPartyName"     varchar(200),
        "reversesHeaderId"   uuid,
        "reversedByHeaderId" uuid,
        "createdByUserId"    uuid                            NOT NULL,
        "complexId"          uuid                            NOT NULL,
        "unitId"             uuid,
        "createdAt"          timestamp                       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_accounting_headers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_accounting_headers_consecutive" UNIQUE ("complexId","documentType","consecutive"),
        CONSTRAINT "CHK_accounting_headers_balanced" CHECK ("totalDebit" = "totalCredit"),
        CONSTRAINT "FK_accounting_headers_complex" FOREIGN KEY ("complexId") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_accounting_headers_unit"    FOREIGN KEY ("unitId")    REFERENCES "units"("id")                ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_accounting_headers_date" ON "accounting_headers" ("complexId","documentDate")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_accounting_headers_unit" ON "accounting_headers" ("complexId","unitId")`);

    // ─── accounting_lines ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "accounting_lines" (
        "id"           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "headerId"     uuid          NOT NULL,
        "pucAccountId" uuid          NOT NULL,
        "debit"        numeric(18,2) NOT NULL DEFAULT 0,
        "credit"       numeric(18,2) NOT NULL DEFAULT 0,
        "memo"         text,
        "complexId"    uuid          NOT NULL,
        "unitId"       uuid,
        "createdAt"    timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_accounting_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_accounting_lines_one_side" CHECK (
          ("debit" >= 0 AND "credit" >= 0) AND NOT ("debit" > 0 AND "credit" > 0)
        ),
        CONSTRAINT "FK_accounting_lines_header"  FOREIGN KEY ("headerId")     REFERENCES "accounting_headers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_accounting_lines_account" FOREIGN KEY ("pucAccountId") REFERENCES "puc_accounts"("id")       ON DELETE RESTRICT,
        CONSTRAINT "FK_accounting_lines_unit"    FOREIGN KEY ("unitId")       REFERENCES "units"("id")              ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_accounting_lines_header"  ON "accounting_lines" ("headerId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_accounting_lines_account" ON "accounting_lines" ("complexId","pucAccountId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_accounting_lines_unit"    ON "accounting_lines" ("complexId","unitId")`);

    // ─── property_account_status ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_account_status" (
        "id"             uuid          NOT NULL DEFAULT gen_random_uuid(),
        "complexId"      uuid          NOT NULL,
        "unitId"         uuid          NOT NULL,
        "currentBalance" numeric(18,2) NOT NULL DEFAULT 0,
        "prepaidBalance" numeric(18,2) NOT NULL DEFAULT 0,
        "version"        integer       NOT NULL DEFAULT 1,
        "lastMovementAt" timestamptz,
        "createdAt"      timestamp     NOT NULL DEFAULT now(),
        "updatedAt"      timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_account_status" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_property_account_status_unit" UNIQUE ("complexId","unitId"),
        CONSTRAINT "CHK_property_prepaid_nonneg" CHECK ("prepaidBalance" >= 0),
        CONSTRAINT "FK_property_account_status_unit" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE
      )
    `);

    // ─── recurring_charges ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recurring_charges" (
        "id"                   uuid                         NOT NULL DEFAULT gen_random_uuid(),
        "concept"              varchar(200)                 NOT NULL,
        "type"                 "recurring_charge_type_enum" NOT NULL,
        "amount"               numeric(18,2)                NOT NULL,
        "totalInstallments"    integer,
        "currentInstallment"   integer                      NOT NULL DEFAULT 0,
        "isActive"             boolean                      NOT NULL DEFAULT true,
        "billingDay"           integer                      NOT NULL DEFAULT 1,
        "incomeAccountId"      uuid                         NOT NULL,
        "complexId"            uuid                         NOT NULL,
        "unitId"               uuid,
        "prorateByCoefficient" boolean                      NOT NULL DEFAULT false,
        "createdByUserId"      uuid                         NOT NULL,
        "createdAt"            timestamp                    NOT NULL DEFAULT now(),
        "updatedAt"            timestamp                    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recurring_charges" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recurring_charges_account" FOREIGN KEY ("incomeAccountId") REFERENCES "puc_accounts"("id")       ON DELETE RESTRICT,
        CONSTRAINT "FK_recurring_charges_complex" FOREIGN KEY ("complexId")       REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_recurring_charges_unit"    FOREIGN KEY ("unitId")          REFERENCES "units"("id")                ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_recurring_charges_active" ON "recurring_charges" ("complexId","isActive")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_recurring_charges_unit"   ON "recurring_charges" ("complexId","unitId")`);

    // ─── tenant_financial_configs ─────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_financial_configs" (
        "id"                      uuid                  NOT NULL DEFAULT gen_random_uuid(),
        "complexId"               uuid                  NOT NULL,
        "lateInterestRate"        numeric(6,3)          NOT NULL DEFAULT 0,
        "lateInterestType"        "interest_type_enum"  NOT NULL DEFAULT 'nominal_monthly',
        "moraCutoffDay"           integer               NOT NULL DEFAULT 1,
        "earlyPaymentDiscountPct" numeric(6,3)          NOT NULL DEFAULT 0,
        "earlyPaymentLimitDay"    integer               NOT NULL DEFAULT 0,
        "contingencyFundPct"      numeric(6,3)          NOT NULL DEFAULT 1.0,
        "updatedByUserId"         uuid,
        "createdAt"               timestamp             NOT NULL DEFAULT now(),
        "updatedAt"               timestamp             NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_financial_configs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tenant_financial_configs_complex" UNIQUE ("complexId"),
        CONSTRAINT "FK_tenant_financial_configs_complex" FOREIGN KEY ("complexId") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);

    // ─── document_sequences ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_sequences" (
        "id"           uuid                            NOT NULL DEFAULT gen_random_uuid(),
        "complexId"    uuid                            NOT NULL,
        "documentType" "accounting_document_type_enum" NOT NULL,
        "lastNumber"   integer                         NOT NULL DEFAULT 0,
        "updatedAt"    timestamp                       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_sequences" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_document_sequences_complex_type" UNIQUE ("complexId","documentType")
      )
    `);

    // ─── Triggers de inmutabilidad ────────────────────────────────
    // accounting_headers: DELETE prohibido; UPDATE solo permite enlazar la reversión.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_accounting_headers_immutable()
      RETURNS TRIGGER AS $$
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          RAISE EXCEPTION 'accounting_headers es inmutable: DELETE no permitido (use contra-asiento)';
        END IF;
        IF (
          NEW."id", NEW."documentType", NEW."consecutive", NEW."documentDate", NEW."period",
          NEW."memo", NEW."totalDebit", NEW."totalCredit", NEW."thirdPartyName",
          NEW."reversesHeaderId", NEW."createdByUserId", NEW."complexId", NEW."unitId", NEW."createdAt"
        ) IS DISTINCT FROM (
          OLD."id", OLD."documentType", OLD."consecutive", OLD."documentDate", OLD."period",
          OLD."memo", OLD."totalDebit", OLD."totalCredit", OLD."thirdPartyName",
          OLD."reversesHeaderId", OLD."createdByUserId", OLD."complexId", OLD."unitId", OLD."createdAt"
        ) THEN
          RAISE EXCEPTION 'accounting_headers es inmutable: solo se permite establecer reversedByHeaderId';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_accounting_headers_immutable
      BEFORE UPDATE OR DELETE ON "accounting_headers"
      FOR EACH ROW EXECUTE FUNCTION fn_accounting_headers_immutable();
    `);

    // accounting_lines: totalmente inmutable.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_accounting_lines_immutable()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'accounting_lines es inmutable: UPDATE/DELETE no permitido (use contra-asiento)';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_accounting_lines_immutable
      BEFORE UPDATE OR DELETE ON "accounting_lines"
      FOR EACH ROW EXECUTE FUNCTION fn_accounting_lines_immutable();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_accounting_lines_immutable   ON "accounting_lines"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_accounting_headers_immutable ON "accounting_headers"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_accounting_lines_immutable()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_accounting_headers_immutable()`);

    await queryRunner.query(`DROP TABLE IF EXISTS "document_sequences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_financial_configs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recurring_charges"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "property_account_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "accounting_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "accounting_headers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "puc_accounts"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "interest_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "recurring_charge_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "account_class_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "account_nature_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "accounting_document_type_enum"`);
  }
}
