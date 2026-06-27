import { MigrationInterface, QueryRunner } from 'typeorm';
import { generateSystemCode } from '../../../modules/users/utils/system-code.util';

/**
 * Backfill de `system_code` para usuarios existentes sin código.
 *
 * A partir de ahora TODO usuario recibe `system_code` automáticamente en el
 * hook @BeforeInsert de la entidad User (formato RES-xxxxx), sin importar el
 * rol ni el path de creación. Esta migración cierra el hueco histórico:
 * asigna un código único a las filas con `system_code IS NULL`.
 *
 * Unicidad: se carga en memoria el set de códigos ya emitidos y se reintenta
 * la generación ante colisión, de modo que el batch nunca choca con el índice
 * unique de la columna.
 *
 * Idempotente: si no quedan filas con código nulo, no hace nada.
 */
export class BackfillUserSystemCodes1781001600000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    const pending: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM users WHERE system_code IS NULL`,
    );

    if (pending.length === 0) return;

    // Códigos ya emitidos, para garantizar unicidad dentro del batch.
    const existing: Array<{ system_code: string }> = await queryRunner.query(
      `SELECT system_code FROM users WHERE system_code IS NOT NULL`,
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
    // No reversible: no se puede saber qué códigos fueron asignados por este
    // backfill vs. los generados normalmente. Quitar códigos rompería el login
    // de residentes, así que el down es intencionalmente no-op.
  }
}
