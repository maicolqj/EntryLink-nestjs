import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Radicación de PQRF: peticiones, quejas, reclamos y felicitaciones.
 *
 * El campo que manda es `addressee`: decide a quién se notifica y, sobre todo,
 * quién puede leer el radicado. Una queja dirigida solo al consejo no le aparece
 * a la administración, que es la única forma de que un residente pueda quejarse
 * del administrador.
 *
 * `consecutive` sostiene el número visible (`code`), que es lo que el residente
 * cita cuando reclama por su solicitud. Es único por complejo, no global.
 *
 * Corre fuera de transacción porque agrega valores a enums nativos y los usa el
 * seed a continuación.
 */
export class CreatePqrf1781004200000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pqrf_requests" (
        "id"                   uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "code"                 varchar(20)  NOT NULL,
        "consecutive"          int          NOT NULL,
        "type"                 varchar(20)  NOT NULL,
        "addressee"            varchar(20)  NOT NULL,
        "status"               varchar(20)  NOT NULL DEFAULT 'RADICADO',
        "subject"              varchar(200) NOT NULL,
        "description"          text         NOT NULL,
        "resident_id"          uuid,
        "unit_id"              uuid,
        "requested_by_user_id" uuid,
        "requested_by_name"    varchar(200),
        "complex_id"           uuid         NOT NULL,
        "created_at"           timestamptz  NOT NULL DEFAULT now(),
        "updated_at"           timestamptz  NOT NULL DEFAULT now(),
        "deleted_at"           timestamptz,
        CONSTRAINT "PK_pqrf_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pqrf_requests_code" UNIQUE ("complex_id", "consecutive"),
        CONSTRAINT "FK_pqrf_requests_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pqrf_requests_unit"
          FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pqrf_requests_complex_status"
        ON "pqrf_requests" ("complex_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pqrf_requests_complex_addressee"
        ON "pqrf_requests" ("complex_id", "addressee")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pqrf_requests_resident"
        ON "pqrf_requests" ("resident_id")
    `);

    // Enums nativos: sin estos labels el seed de permisos falla entero y el
    // aviso del radicado se pierde en el INSERT, que va fire-and-forget.
    for (const value of ['VIEW_PQRF', 'CREATE_PQRF']) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'PQRF_RECEIVED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS 'PQRF_RECEIVED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pqrf_requests"`);
    // Los labels de los enums no se revierten: Postgres no permite quitarlos.
  }
}
