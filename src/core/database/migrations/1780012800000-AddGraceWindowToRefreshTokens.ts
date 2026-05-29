import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddGraceWindowToRefreshTokens1780012800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('refresh_tokens', [
      new TableColumn({
        name: 'previous_token_hash',
        type: 'varchar',
        isNullable: true,
      }),
      new TableColumn({
        name: 'previous_token_valid_until',
        type: 'timestamp',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('refresh_tokens', 'previous_token_valid_until');
    await queryRunner.dropColumn('refresh_tokens', 'previous_token_hash');
  }
}
