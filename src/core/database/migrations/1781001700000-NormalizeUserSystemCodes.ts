import { MigrationInterface, QueryRunner } from 'typeorm';
import { generateSystemCode } from '../../../modules/users/utils/system-code.util';

/**
 * Normaliza los `system_code` históricos al formato canónico `RES-xxxxx`.
 *
 * Antes existían códigos con formato viejo `RES-XXXX-XXXX` (dos segmentos hex)
 * generados por varios services duplicados. Tras unificar la generación en
 * `generateSystemCode()` (formato RES-xxxxx), esta migración reescribe toda
 * fila cuyo código NO cumpla el patrón canónico.
 *
 * ⚠️ ROTACIÓN DE CREDENCIAL: el `system_code` es la credencial de login del
 * residente (documento + código). Reescribirlo invalida el código anterior;
 * los residentes afectados deben recibir su nuevo código. Los códigos viejos
 * `RES-XXXX-XXXX` ya no pasaban la validación de formato de login, así que
 * esos residentes ya estaban bloqueados — esto los rehabilita con un código
 * válido.
 *
 * Solo toca los no conformes: los códigos ya en formato `RES-xxxxx` (incluido
 * el backfill previo) se conservan intactos.
 *
 * Idempotente: re-ejecutar no cambia nada si todo ya cumple el formato.
 */
export class NormalizeUserSystemCodes1781001700000 implements MigrationInterface {

  // Debe coincidir con SYSTEM_CODE_REGEX. Sintaxis POSIX de Postgres.
  private static readonly CANONICAL_PATTERN = '^RES-[A-Za-z0-9]{5}$';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const pattern = NormalizeUserSystemCodes1781001700000.CANONICAL_PATTERN;

    // Filas con código fuera del formato canónico (incluye NULL por seguridad).
    const pending: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM users WHERE system_code IS NULL OR system_code !~ $1`,
      [pattern],
    );

    if (pending.length === 0) return;

    // Códigos ya conformes, para garantizar unicidad del batch.
    const existing: Array<{ system_code: string }> = await queryRunner.query(
      `SELECT system_code FROM users WHERE system_code ~ $1`,
      [pattern],
    );
    const used = new Set(existing.map((row) => row.system_code));

    for (const { id } of pending) {
      let code = generateSystemCode();
      while (used.has(code)) {
        code = generateSystemCode();
      }
      used.add(code);

      await queryRunner.query(
        `UPDATE users SET system_code = $1 WHERE id = $2`,
        [code, id],
      );
    }
  }

  public async down(): Promise<void> {
    // No reversible: los códigos viejos no se conservan y reconstruirlos
    // rompería el login. Down intencionalmente no-op.
  }
}
