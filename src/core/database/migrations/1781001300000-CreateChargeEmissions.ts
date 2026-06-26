import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea "charge_emissions": emisión de cargos por período con reglas de cálculo
 * embebidas (jsonb). Capa de orquestación sobre el motor de cargos: al
 * confirmarse genera los FeeCharge (UnitCharge) de cada unidad.
 *
 * Único (complexId, conceptName, period) → no se emite dos veces el mismo
 * concepto en el mismo período. Columnas en camelCase (igual que el resto del
 * módulo finance). Idempotente.
 */
export class CreateChargeEmissions1781001300000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "charge_emission_status_enum" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "charge_emission_billing_mode_enum" AS ENUM ('ADVANCE', 'ARREARS');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "charge_emissions" (
        "id"                 uuid          NOT NULL DEFAULT gen_random_uuid(),
        "conceptName"        varchar(200)  NOT NULL,
        "description"        text,
        "period"             varchar(7)    NOT NULL,
        "status"             "charge_emission_status_enum"       NOT NULL DEFAULT 'DRAFT',
        "dueDate"            timestamptz   NOT NULL,
        "billingMode"        "charge_emission_billing_mode_enum" NOT NULL DEFAULT 'ADVANCE',
        "rules"              jsonb         NOT NULL DEFAULT '[]',
        "generatedCount"     int           NOT NULL DEFAULT 0,
        "confirmedAt"        timestamptz,
        "cancellationReason" text,
        "complexId"          uuid          NOT NULL,
        "categoryId"         uuid,
        "createdByUserId"    uuid          NOT NULL,
        "createdAt"          timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"          timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_charge_emissions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_charge_emissions_complex_status"
      ON "charge_emissions" ("complexId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_charge_emissions_complex_period"
      ON "charge_emissions" ("complexId", "period")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_charge_emissions_concept_period"
      ON "charge_emissions" ("complexId", "conceptName", "period")
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "charge_emissions"
        ADD CONSTRAINT "FK_charge_emissions_complex"
        FOREIGN KEY ("complexId") REFERENCES "residential_complexes"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "charge_emissions"
        ADD CONSTRAINT "FK_charge_emissions_category"
        FOREIGN KEY ("categoryId") REFERENCES "charge_categories"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "charge_emissions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "charge_emission_billing_mode_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "charge_emission_status_enum"`);
  }
}
