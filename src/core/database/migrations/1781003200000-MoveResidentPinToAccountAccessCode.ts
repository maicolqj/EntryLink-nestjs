import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mueve la credencial del residente del dispositivo a la cuenta.
 *
 * Antes cada `resident_devices` guardaba su propio `pin_hash`, así que vincular
 * un equipo nuevo obligaba a inventar otro PIN. Ahora la clave vive una sola vez
 * en `users.access_code_hash` y sirve en todos los equipos vinculados; el
 * dispositivo aporta el otro factor, no la credencial.
 *
 * Los intentos fallidos y el bloqueo también suben a la cuenta: contarlos por
 * dispositivo permitía multiplicar los intentos con solo cambiar de aparato.
 *
 * Los PIN existentes NO se migran. Son hashes bcrypt —irreversibles— y un
 * residente con dos equipos podía tener dos PIN distintos, sin criterio para
 * elegir cuál conservar. Las cuentas quedan sin clave y la app se las pide en el
 * siguiente ingreso, que llega por WhatsApp entrante o por aprobación.
 */
export class MoveResidentPinToAccountAccessCode1781003200000 implements MigrationInterface {
  name = 'MoveResidentPinToAccountAccessCode1781003200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "access_code_hash" text,
        ADD COLUMN IF NOT EXISTS "access_code_failed_attempts" smallint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "access_code_locked_until" timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE "resident_devices"
        DROP COLUMN IF EXISTS "pin_hash",
        DROP COLUMN IF EXISTS "failed_attempts",
        DROP COLUMN IF EXISTS "locked_until"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // El PIN por dispositivo vuelve vacío: los hashes originales se perdieron al
    // eliminar la columna y no hay forma de reconstruirlos.
    await queryRunner.query(`
      ALTER TABLE "resident_devices"
        ADD COLUMN IF NOT EXISTS "pin_hash" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "failed_attempts" smallint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "locked_until" timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "access_code_hash",
        DROP COLUMN IF EXISTS "access_code_failed_attempts",
        DROP COLUMN IF EXISTS "access_code_locked_until"
    `);
  }
}
