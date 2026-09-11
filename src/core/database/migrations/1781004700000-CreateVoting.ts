import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Votaciones en asambleas y reuniones del consejo.
 *
 * Reunión → preguntas → opciones, y los votos aparte. El índice único de
 * `voting_ballots` sobre (pregunta, voter_key) es la regla del módulo: un voto
 * por unidad en asamblea y uno por consejero en el consejo, garantizado por la
 * base aunque dos residentes del mismo apartamento voten en el mismo segundo.
 *
 * `residential_complexes.voting_enabled` es el interruptor con el que la
 * administración le muestra el módulo a los residentes.
 *
 * Corre fuera de transacción porque agrega un valor a enums nativos, como la
 * migración de PQRF.
 */
export class CreateVoting1781004700000 implements MigrationInterface {

  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "voting_enabled" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voting_meetings" (
        "id"                 uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "kind"               varchar(20)  NOT NULL,
        "title"              varchar(200) NOT NULL,
        "description"        text,
        "scheduled_at"       timestamptz  NOT NULL,
        "created_by_user_id" uuid,
        "complex_id"         uuid         NOT NULL,
        "created_at"         timestamptz  NOT NULL DEFAULT now(),
        "updated_at"         timestamptz  NOT NULL DEFAULT now(),
        "deleted_at"         timestamptz,
        CONSTRAINT "PK_voting_meetings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_voting_meetings_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_voting_meetings_complex_kind"
        ON "voting_meetings" ("complex_id", "kind")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voting_questions" (
        "id"              uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "meeting_id"      uuid          NOT NULL,
        "position"        int           NOT NULL DEFAULT 0,
        "text"            varchar(500)  NOT NULL,
        "description"     text,
        "weighting"       varchar(20)   NOT NULL,
        "secrecy"         varchar(20)   NOT NULL DEFAULT 'NOMINAL',
        "status"          varchar(20)   NOT NULL DEFAULT 'DRAFT',
        "opened_at"       timestamptz,
        "closed_at"       timestamptz,
        "eligible_count"  int,
        "eligible_weight" numeric(14,6),
        "complex_id"      uuid          NOT NULL,
        "created_at"      timestamptz   NOT NULL DEFAULT now(),
        "updated_at"      timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"      timestamptz,
        CONSTRAINT "PK_voting_questions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_voting_questions_meeting"
          FOREIGN KEY ("meeting_id") REFERENCES "voting_meetings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_voting_questions_complex"
          FOREIGN KEY ("complex_id") REFERENCES "residential_complexes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_voting_questions_meeting"
        ON "voting_questions" ("meeting_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_voting_questions_complex_status"
        ON "voting_questions" ("complex_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voting_options" (
        "id"          uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "question_id" uuid         NOT NULL,
        "position"    int          NOT NULL DEFAULT 0,
        "text"        varchar(200) NOT NULL,
        CONSTRAINT "PK_voting_options_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_voting_options_question"
          FOREIGN KEY ("question_id") REFERENCES "voting_questions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_voting_options_question"
        ON "voting_options" ("question_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voting_ballots" (
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "question_id" uuid          NOT NULL,
        "option_id"   uuid          NOT NULL,
        "complex_id"  uuid          NOT NULL,
        "voter_key"   varchar(60)   NOT NULL,
        "unit_id"     uuid,
        "user_id"     uuid,
        "resident_id" uuid,
        "weight"      numeric(14,6) NOT NULL,
        "created_at"  timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_voting_ballots_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_voting_ballots_voter" UNIQUE ("question_id", "voter_key"),
        CONSTRAINT "FK_voting_ballots_question"
          FOREIGN KEY ("question_id") REFERENCES "voting_questions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_voting_ballots_option"
          FOREIGN KEY ("option_id") REFERENCES "voting_options"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_voting_ballots_unit"
          FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_voting_ballots_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Sin estos labels el aviso de "votación abierta" se pierde en el INSERT,
    // que va fire-and-forget.
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'VOTING_OPENED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_batches_type_enum" ADD VALUE IF NOT EXISTS 'VOTING_OPENED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "voting_ballots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "voting_options"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "voting_questions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "voting_meetings"`);
    await queryRunner.query(`ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "voting_enabled"`);
    // Los labels de los enums no se revierten: Postgres no permite quitarlos.
  }
}
