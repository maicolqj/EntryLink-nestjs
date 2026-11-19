/**
 * Lotes anteriores con el mismo archivo (mismo sha256), para avisar de una
 * importación repetida.
 *
 * Sin VIEW_ALL_GROWTH_PROSPECTS solo se cuentan los lotes propios: los de
 * otras personas no se ven (`get` responde NOT_FOUND) y su id no debe salir
 * por aquí. `ownerId = null` significa que el actor ve todos los lotes.
 */
export function previousBatchesQuery(
  fileSha256: string,
  excludeBatchId: string,
  ownerId: string | null,
): { sql: string; params: string[] } {
  const params = [fileSha256, excludeBatchId];
  let owner = '';
  if (ownerId !== null) {
    params.push(ownerId);
    owner = ' AND created_by_user_id = $3';
  }
  return {
    sql: `SELECT id FROM growth.import_batches WHERE file_sha256 = $1 AND id <> $2${owner} ORDER BY created_at`,
    params,
  };
}
