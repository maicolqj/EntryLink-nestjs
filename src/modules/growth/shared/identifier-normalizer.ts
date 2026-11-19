import { GrowthIdentifierType } from './growth.enums';

/**
 * Forma canónica de un identificador antes de calcular su hash. Dos formas de
 * escribir el mismo dato ("Ventas@Empresa.co " / "ventas@empresa.co") deben
 * dar el mismo hash, o la lista de exclusión no bloquearía nada.
 *
 * Devuelve null si el valor no es válido para su tipo.
 */
export function normalizeIdentifier(
  type: GrowthIdentifierType,
  raw: string,
): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  switch (type) {
    case GrowthIdentifierType.EMAIL: {
      const email = value.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
    }
    case GrowthIdentifierType.PHONE:
      return normalizeColombianPhone(value);
    case GrowthIdentifierType.NIT: {
      // El dígito de verificación no identifica: "900.123.456-7" = "900123456".
      const base = value.split('-')[0].replace(/[\s.]/g, '');
      return /^\d{6,10}$/.test(base) ? base : null;
    }
    case GrowthIdentifierType.DOMAIN: {
      let domain = value.toLowerCase();
      domain = domain.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
      domain = domain.replace(/^www\./, '').replace(/\.$/, '');
      return /^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)
        ? domain
        : null;
    }
    default:
      return null;
  }
}

/** E.164 para Colombia: celulares (3xx) y fijos (60x), 10 dígitos nacionales. */
function normalizeColombianPhone(value: string): string | null {
  let digits = value.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
    if (!digits.startsWith('57')) {
      // Número extranjero: se conserva en E.164 tal cual.
      return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
    }
    digits = digits.slice(2);
  } else if (digits.startsWith('57') && digits.length === 12) {
    digits = digits.slice(2);
  }
  return /^(3\d{9}|60\d{8})$/.test(digits) ? `+57${digits}` : null;
}
