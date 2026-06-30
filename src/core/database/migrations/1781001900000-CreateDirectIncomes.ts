import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea la tabla `direct_incomes` para ingresos directos a caja/banco no
 * originados en cuotas de administración (parqueadero, alquiler de salón,
 * multas, rendimientos, etc.). Espejo de `complex_expenses`.
 *
 * El proyecto corre con `synchronize: false` y SIN naming strategy global,
 * por lo que las columnas conservan el nombre camelCase de la entidad y deben
 * ir entre comillas dobles. Idempotente.
 */
export class CreateDirectIncomes1781001900000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'direct_incomes_category_enum') THEN
          CREATE TYPE "direct_incomes_category_enum" AS ENUM (
            'PARKING', 'HALL_RENTAL', 'FINES', 'INTEREST', 'SALE', 'DONATION', 'OTHER'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "direct_incomes" (
        "id"                 uuid NOT NULL DEFAULT uuid_generate_v4(),
        "description"        character varying(500) NOT NULL,
        "amount"             numeric(12,2) NOT NULL,
        "category"           "direct_incomes_category_enum" NOT NULL,
        "period"             character varying(7) NOT NULL,
        "incomeDate"         date NOT NULL,
        "receiptUrl"         character varying(2048),
        "notes"              text,
        "isReversed"         boolean NOT NULL DEFAULT false,
        "reversalReason"     character varying(500),
        "reversedByUserId"   character varying,
        "reversedAt"         timestamptz,
        "complexId"          character varying NOT NULL,
        "registeredByUserId" character varying,
        "createdAt"          TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"          TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt"          TIMESTAMP,
        CONSTRAINT "PK_direct_incomes_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_direct_incomes_complex_period"
        ON "direct_incomes" ("complexId", "period")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_direct_incomes_complex_date"
        ON "direct_incomes" ("complexId", "incomeDate")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_direct_incomes_complex_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_direct_incomes_complex_period"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "direct_incomes"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "direct_incomes_category_enum"`);
  }
}
