import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contraseña inicial que asigna el administrador: el usuario debe cambiarla
 * al entrar. Mientras la marca esté encendida, el panel le pide una nueva y
 * no lo deja seguir.
 */
export class UserMustChangePassword1781008700000 implements MigrationInterface {
  name = 'UserMustChangePassword1781008700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password"`,
    );
  }
}
