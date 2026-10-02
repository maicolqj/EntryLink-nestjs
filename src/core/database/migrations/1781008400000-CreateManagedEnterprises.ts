import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Empresa de Android Management API para los equipos de portería en modo
 * kiosco. Arranca vacía: el SUPER_ADMIN la vincula desde el panel.
 */
export class CreateManagedEnterprises1781008400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "managed_enterprises" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "display_name" varchar(200),
        "policy_hash" varchar(64),
        "policy_applied_at" TIMESTAMPTZ,
        "created_by_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_managed_enterprises" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_managed_enterprises_name" UNIQUE ("name")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "managed_enterprises"`);
  }
}
