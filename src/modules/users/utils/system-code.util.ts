import { randomBytes } from 'crypto';

/**
 * Alfabeto del segmento aleatorio del código de sistema.
 * Mayúsculas + dígitos, sin caracteres ambiguos (I, O, 0, 1) para evitar
 * confusiones al dictar/escribir el código manualmente.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Longitud del segmento aleatorio (RES-xxxxx). */
const CODE_LENGTH = 5;

export const SYSTEM_CODE_PREFIX = 'RES';

/**
 * Formato canónico del código de sistema: `RES-xxxxx` (5 chars alfanuméricos).
 * Fuente única de verdad — la usan tanto la validación de login como las
 * migraciones de normalización. Case-insensitive: el residente puede escribir
 * en minúscula; la comparación en login normaliza a mayúscula.
 */
export const SYSTEM_CODE_REGEX = /^RES-[A-Za-z0-9]{5}$/;

/**
 * Genera un código de sistema legible con formato `RES-xxxxx`
 * (ej: `RES-K7P3M`).
 *
 * Se asigna a TODO usuario sin importar su rol o cómo fue creado
 * (admin, residente, seguridad, import masivo, seeds). La unicidad final
 * la garantiza el índice unique de la columna `system_code`; este helper
 * solo aporta la entropía. Para generación en lote (backfill) se debe
 * verificar colisión contra los códigos ya emitidos.
 */
export function generateSystemCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let segment = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    segment += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${SYSTEM_CODE_PREFIX}-${segment}`;
}
