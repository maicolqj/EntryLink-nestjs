import { GRACE_DAYS } from './subscription-status';

/**
 * Condición SQL: la fila pertenece a un conjunto cuyas automatizaciones no
 * están pausadas. Equivale a `isAutomationPaused`, pero va dentro de la consulta
 * para que los conjuntos pausados no ocupen los lotes con `take`.
 *
 * Compara como texto porque `complexId` no tiene el mismo tipo en todas las
 * tablas, y Postgres rechaza `uuid = varchar`.
 * Va con CAST y no con `::`: TypeORM no traduce el nombre de una propiedad
 * seguido de `::` y la consulta revienta con "missing FROM-clause".
 *
 * @param complexColumn columna o propiedad del conjunto, ya calificada.
 */
export function operableComplexSql(complexColumn: string): string {
  return (
    `NOT EXISTS (SELECT 1 FROM residential_complexes sub_c ` +
    `WHERE sub_c.id::text = CAST(${complexColumn} AS text) ` +
    `AND sub_c.subscription_ends_at + interval '${GRACE_DAYS} days' <= now())`
  );
}
