import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Horarios de "Mi Conjunto": atención de la administración, shut de basuras,
 * reciclaje… Las franjas van en jsonb: siempre se leen y se reemplazan juntas.
 */
export class CreateComplexSchedules1781008500000 implements MigrationInterface {
  name = 'CreateComplexSchedules1781008500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "complex_schedule_category" AS ENUM (
          'ADMINISTRATION', 'SECURITY', 'WASTE', 'RECYCLING',
          'COMMON_AREA', 'SERVICE', 'OTHER'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "complex_schedules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "complex_id" uuid NOT NULL,
        "category" "complex_schedule_category" NOT NULL,
        "name" varchar(120) NOT NULL,
        "slots" jsonb NOT NULL DEFAULT '[]',
        "note" text,
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_complex_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_complex_schedules_complex" FOREIGN KEY ("complex_id")
          REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_complex_schedules_complex" ON "complex_schedules" ("complex_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "complex_schedules"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "complex_schedule_category"`);
  }
}
