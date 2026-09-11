import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consejeros con voz pero sin voto.
 *
 * No todo el consejo vota: los suplentes participan en la reunión pero su voto
 * no cuenta. Se guarda a quien NO vota —y no a quien sí— para que el consejero
 * que nombren después vote por defecto, que es el caso común.
 */
export class VotingCouncilVoiceOnly1781004800000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "voting_council_voice_only_user_ids" uuid[] NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "voting_council_voice_only_user_ids"
    `);
  }
}
