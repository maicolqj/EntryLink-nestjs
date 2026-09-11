import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plazo de respuesta del PQRF y silencio administrativo positivo.
 *
 * Un radicado no puede quedar abierto para siempre porque nadie lo atendió. La
 * copropiedad fija en su reglamento cuánto tiempo tiene para responder —el
 * defecto es el plazo legal colombiano para peticiones, 15 días—, se le insiste
 * antes de que venza, y si aun así nadie responde, el radicado se resuelve solo
 * a favor de quien lo puso. Eso último es lo que la ley llama silencio
 * administrativo positivo, y por eso se marca aparte: no es una respuesta.
 *
 * Los días son CALENDARIO. La plataforma no tiene calendario de festivos, y
 * contar "días hábiles" sin él daría plazos equivocados con cara de exactos.
 *
 * Fuera de transacción porque agrega un valor a un enum nativo.
 */
export class PqrfDeadline1781004400000 implements MigrationInterface {

  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "pqrf_resolution_days"         int NOT NULL DEFAULT 15,
        ADD COLUMN IF NOT EXISTS "pqrf_reminder_lead_days"      int NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS "pqrf_reminder_interval_hours" int NOT NULL DEFAULT 24
    `);

    await queryRunner.query(`
      ALTER TABLE "pqrf_requests"
        ADD COLUMN IF NOT EXISTS "resolved_by_silence" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "last_reminder_at"    timestamptz,
        ADD COLUMN IF NOT EXISTS "due_at"              timestamptz
    `);

    // Lo ya radicado también necesita fecha de vencimiento: se calcula con el
    // plazo del complejo contado desde el día en que se radicó.
    await queryRunner.query(`
      UPDATE "pqrf_requests" p
         SET "due_at" = p."created_at" + (c."pqrf_resolution_days" || ' days')::interval
        FROM "residential_complexes" c
       WHERE c."id" = p."complex_id" AND p."due_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "pqrf_requests" ALTER COLUMN "due_at" SET NOT NULL
    `);

    // El barrido busca lo vencido y lo que está por vencer.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pqrf_requests_due"
        ON "pqrf_requests" ("status", "due_at")
    `);

    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'PQRF_REMINDER'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS 'PQRF_REMINDER'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pqrf_requests_due"`);
    await queryRunner.query(`
      ALTER TABLE "pqrf_requests"
        DROP COLUMN IF EXISTS "due_at",
        DROP COLUMN IF EXISTS "last_reminder_at",
        DROP COLUMN IF EXISTS "resolved_by_silence"
    `);
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "pqrf_reminder_interval_hours",
        DROP COLUMN IF EXISTS "pqrf_reminder_lead_days",
        DROP COLUMN IF EXISTS "pqrf_resolution_days"
    `);
  }
}
