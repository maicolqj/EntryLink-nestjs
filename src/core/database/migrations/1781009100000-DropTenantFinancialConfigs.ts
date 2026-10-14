import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina `tenant_financial_configs` y su enum `interest_type_enum`.
 *
 * La tabla nació con el ledger contable (1781000000000) para guardar mora,
 * pronto pago y fondo de imprevistos por conjunto, pero ningún servicio llegó
 * a leerla ni escribirla: esa configuración vive en `complex_finance_configs`.
 * Nunca tuvo filas. El enum solo lo usaba esta tabla.
 *
 * El `down` la recrea vacía, igual que la creó la migración original.
 */
export class DropTenantFinancialConfigs1781009100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_financial_configs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "interest_type_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "interest_type_enum" AS ENUM ('nominal_monthly','effective_annual');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
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
  }
}
