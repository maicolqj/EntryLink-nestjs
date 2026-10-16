import { randomInt } from 'crypto';

/**
 * Códigos de recomendación entre conjuntos.
 *
 * Sin dependencias de Nest: los usa el registro público (módulo de complejos)
 * y la suscripción, y un import entre esos dos servicios arma un ciclo.
 */

/** Días que recibe el conjunto que recomendó, con el primer pago del recomendado. */
export const REFERRAL_REWARD_DAYS = 30;

/** Sin 0/O ni 1/I/L: el código se dicta por teléfono y se copia a mano. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

export const generateReferralCode = (): string =>
  Array.from(
    { length: CODE_LENGTH },
    () => ALPHABET[randomInt(ALPHABET.length)],
  ).join('');

/** Mayúsculas y sin espacios ni guiones: "ab12-cd34 " = "AB12CD34". */
export const normalizeReferralCode = (code?: string | null): string | null => {
  const clean = (code ?? '').replace(/[\s-]/g, '').toUpperCase();
  return clean || null;
};
