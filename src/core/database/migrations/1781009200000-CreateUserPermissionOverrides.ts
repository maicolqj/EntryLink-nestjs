import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Excepciones de permisos por usuario: dar (GRANT) o quitar (DENY) un permiso
 * a una persona por encima de lo que le dan sus roles.
 *
 * Una fila por usuario y permiso. Si se borra el usuario o el permiso, la
 * excepción se va con él.
 */
export class CreateUserPermissionOverrides1781009200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "permission_override_effect" AS ENUM ('GRANT', 'DENY');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        "effect" "permission_override_effect" NOT NULL,
        "reason" text,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_permission_overrides" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_permission_overrides_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_permission_overrides_permission" FOREIGN KEY ("permission_id")
          REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_permission_overrides_user_permission"
        ON "user_permission_overrides" ("user_id", "permission_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_permission_overrides"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "permission_override_effect"`);
  }
}
