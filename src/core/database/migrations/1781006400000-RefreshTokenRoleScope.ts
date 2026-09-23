import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega `refresh_tokens.role_scope`: los roles a los que está limitada una
 * sesión.
 *
 * Una misma cuenta puede ser residente y administrar el conjunto. Los canales
 * de residente —WhatsApp entrante, OTP, código de sistema, clave del
 * dispositivo, aprobación desde otro equipo— prueban posesión del teléfono, no
 * la contraseña, así que la sesión que abren sale acotada a RESIDENT_ROL.
 *
 * El alcance vive en la fila y no solo dentro del JWT porque la rotación
 * reconstruye el access token leyendo los roles de la base. Sin persistirlo, la
 * sesión recuperaba los roles administrativos en el primer refresh: una
 * escalada silenciosa quince minutos después de entrar.
 *
 * NULL = sin límite, el token sale con todos los roles del usuario. Es el valor
 * de todas las filas existentes, así que las sesiones abiertas no cambian.
 */
export class RefreshTokenRoleScope1781006400000 implements MigrationInterface {
  name = 'RefreshTokenRoleScope1781006400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN IF NOT EXISTS "role_scope" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        DROP COLUMN IF EXISTS "role_scope"
    `);
  }
}
