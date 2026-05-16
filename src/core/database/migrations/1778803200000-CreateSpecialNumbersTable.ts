import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSpecialNumbersTable1778803200000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "special_numbers" (
        "id"           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "name"         varchar(100)  NOT NULL,
        "phone_number" varchar(50)   NOT NULL,
        "category"     varchar(50)   NOT NULL,
        "description"  text,
        "order"        integer       NOT NULL DEFAULT 0,
        "is_global"    boolean       NOT NULL DEFAULT false,
        "complex_id"   uuid,
        "created_at"   timestamptz   NOT NULL DEFAULT now(),
        "updated_at"   timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_special_numbers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_special_numbers_scope"
          CHECK (
            (is_global = true  AND complex_id IS NULL) OR
            (is_global = false AND complex_id IS NOT NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_special_numbers_global_order"
      ON "special_numbers" ("is_global", "order")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_special_numbers_complex_order"
      ON "special_numbers" ("complex_id", "order")
    `);

    await queryRunner.query(`
      ALTER TABLE "special_numbers"
      ADD CONSTRAINT "FK_special_numbers_complex"
      FOREIGN KEY ("complex_id")
      REFERENCES "residential_complexes"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "special_numbers"`);
  }
}
