import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Versión mínima obligatoria de las apps móviles, por app y plataforma.
 *
 * Arranca vacía a propósito: sin fila no se obliga a nadie. El SUPER_ADMIN la
 * sube desde el panel cuando un cambio rompe compatibilidad.
 */
export class CreateAppVersionPolicies1781008300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_version_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "app" varchar(20) NOT NULL,
        "platform" varchar(10) NOT NULL,
        "min_version_code" int NOT NULL DEFAULT 0,
        "message" text,
        "updated_by_id" uuid,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_version_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_app_version_policies_app_platform" UNIQUE ("app", "platform")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "app_version_policies"`);
  }
}
