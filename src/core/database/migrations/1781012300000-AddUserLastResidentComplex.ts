import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Selector de conjunto de RemoteLink: recuerda el último conjunto que eligió
 * el residente para que el próximo inicio de sesión entre ahí. Si borran el
 * conjunto, el valor queda en NULL y se vuelve a la regla de la residencia
 * principal.
 */
export class AddUserLastResidentComplex1781012300000
  implements MigrationInterface
{
  name = 'AddUserLastResidentComplex1781012300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "last_resident_complex_id" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_last_resident_complex"
        FOREIGN KEY ("last_resident_complex_id")
        REFERENCES "residential_complexes"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_last_resident_complex"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "last_resident_complex_id"`,
    );
  }
}
