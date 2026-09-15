import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Interruptor propio para las reuniones del consejo.
 *
 * `voting_enabled` queda para las asambleas (residentes). Una votación que es
 * solo del consejo no debe obligar a abrirle el módulo a toda la copropiedad.
 */
export class VotingCouncilSwitch1781004900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "voting_council_enabled" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "voting_council_enabled"
    `);
  }
}
