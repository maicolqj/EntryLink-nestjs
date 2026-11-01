/**
 * Similitud de nombres por trigramas (Jaccard), calculada en la aplicación.
 * Equivale en espíritu a pg_trgm sin depender de CREATE EXTENSION en
 * producción. Recibe nombres ya normalizados (minúsculas, sin tildes).
 */
export function trigrams(value: string): Set<string> {
  const padded = `  ${value.trim()} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Dominios de correo gratuitos: no identifican a una empresa. */
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'live.com',
  'msn.com',
]);
