import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la columna `identity_type` a la tabla `users` para almacenar el tipo
 * de documento de identidad (CC, CE, PASSPORT, TI, NIT, FOREIGN_ID, OTHER),
 * complemento del número ya existente en `identity`.
 *
 * El proyecto corre con `synchronize: false`, por lo que el tipo enum nativo
 * y la columna deben crearse explícitamente. Idempotente.
 */
export class AddUserIdentityType1781001800000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_identity_type_enum') THEN
          CREATE TYPE "users_identity_type_enum" AS ENUM (
            'CC', 'CE', 'PASSPORT', 'TI', 'NIT', 'FOREIGN_ID', 'OTHER'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "identity_type" "users_identity_type_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "identity_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_identity_type_enum"`);
  }
}
