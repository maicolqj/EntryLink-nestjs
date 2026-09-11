import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seguimiento del radicado: quién lo abrió y quién lo dio por resuelto.
 *
 * Una fila por PERSONA y no una marca en el radicado: un PQRF dirigido a las dos
 * instancias lo atienden varias personas y darlo por resuelto es responsabilidad
 * de cada una. Mientras falte alguien por marcarlo, el radicado sigue abierto.
 *
 * De paso se simplifica el estado: RESPONDIDO y CERRADO eran dos nombres para lo
 * mismo mientras no exista la respuesta formal, así que ahora hay uno solo,
 * RESUELTO. Las filas existentes se convierten, aunque en la práctica todavía
 * están todas en RADICADO.
 *
 * Fuera de transacción porque agrega un valor a un enum nativo y lo usa el
 * módulo de notificaciones enseguida.
 */
export class PqrfAcknowledgements1781004300000 implements MigrationInterface {

  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pqrf_acknowledgements" (
        "id"          uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "pqrf_id"     uuid         NOT NULL,
        "user_id"     uuid         NOT NULL,
        "user_name"   varchar(200),
        "instance"    varchar(20)  NOT NULL,
        "opened_at"   timestamptz  NOT NULL DEFAULT now(),
        "resolved_at" timestamptz,
        CONSTRAINT "PK_pqrf_acknowledgements_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pqrf_acknowledgements_pqrf"
          FOREIGN KEY ("pqrf_id") REFERENCES "pqrf_requests"("id") ON DELETE CASCADE
      )
    `);

    // Un destinatario deja UNA huella por radicado: abrirlo dos veces no
    // duplica el rastro ni cuenta doble al resolver.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pqrf_acknowledgements_pqrf_user"
        ON "pqrf_acknowledgements" ("pqrf_id", "user_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "pqrf_requests" ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz
    `);

    await queryRunner.query(`
      UPDATE "pqrf_requests" SET "status" = 'RESUELTO'
       WHERE "status" IN ('RESPONDIDO', 'CERRADO')
    `);

    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'PQRF_RESOLVED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS 'PQRF_RESOLVED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pqrf_acknowledgements"`);
    await queryRunner.query(`ALTER TABLE "pqrf_requests" DROP COLUMN IF EXISTS "resolved_at"`);
    await queryRunner.query(`
      UPDATE "pqrf_requests" SET "status" = 'RESPONDIDO' WHERE "status" = 'RESUELTO'
    `);
  }
}
