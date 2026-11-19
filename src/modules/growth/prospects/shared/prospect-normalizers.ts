/**
 * Normalización para búsqueda y deduplicación (1B). No reemplaza el valor
 * original, que se guarda tal como se capturó.
 */

const LEGAL_SUFFIXES = [
  's a s',
  'sas',
  's a',
  'sa',
  'ltda',
  'limitada',
  'e u',
  'eu',
  's en c',
  'y cia',
  'cia',
  'propiedad horizontal',
  'p h',
  'ph',
];

const PROPERTY_PREFIXES = [
  'conjunto residencial',
  'conjunto',
  'edificio',
  'agrupacion de vivienda',
  'agrupacion',
  'urbanizacion',
  'condominio',
  'multifamiliar',
];

export function stripAccents(value: string): string {
  // \p{M}: marcas diacríticas combinantes (tildes, diéresis) tras NFD.
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function basic(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripWords(value: string, words: string[], atStart: boolean): string {
  let result = ` ${value} `;
  for (const w of words) {
    if (atStart) {
      if (result.startsWith(` ${w} `)) result = result.slice(w.length + 1);
    } else {
      result = result.replace(new RegExp(` ${w} `, 'g'), ' ');
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** "Administraciones Andes S.A.S." → "administraciones andes" */
export function normalizeOrganizationName(value: string): string {
  return stripWords(basic(value), LEGAL_SUFFIXES, false) || basic(value);
}

/** "Conjunto Residencial Los Pinos P.H." → "los pinos" */
export function normalizePropertyName(value: string): string {
  const withoutSuffix = stripWords(basic(value), LEGAL_SUFFIXES, false);
  return stripWords(withoutSuffix, PROPERTY_PREFIXES, true) || basic(value);
}

export function normalizePersonName(value: string): string {
  return basic(value);
}

const STREET_TYPES: Array<[RegExp, string]> = [
  [/^(avenida calle|av calle|av cll|ac)$/, 'AC'],
  [/^(avenida carrera|av carrera|av cra|ak)$/, 'AK'],
  [/^(calle|cll|cl|cal)$/, 'CL'],
  [/^(carrera|cra|kr|cr|kra|carr)$/, 'KR'],
  [/^(diagonal|dg|diag)$/, 'DG'],
  [/^(transversal|tv|tr|trans|transv)$/, 'TV'],
  [/^(avenida|av)$/, 'AV'],
];

/**
 * Dirección de Bogotá a forma canónica: "Cra. 15 # 93-47 Of 301" →
 * "KR 15 93 47". Conserva solo tipo de vía y números (y letras de vía);
 * devuelve null si no reconoce el tipo de vía.
 */
export function normalizeBogotaAddress(value: string): string | null {
  const clean = basic(value.replace(/#|no\.|n°|nº/gi, ' '))
    .replace(/\b(bis)\b/g, 'BIS')
    .split(
      /\b(?:of|oficina|apto|apartamento|int|interior|torre|local|piso|casa)\b/,
    )[0]
    .trim();
  const tokens = clean.split(' ');
  for (let take = 2; take >= 1; take--) {
    const head = tokens.slice(0, take).join(' ');
    const match = STREET_TYPES.find(([re]) => re.test(head));
    if (match) {
      const rest = tokens
        .slice(take)
        .join(' ')
        .replace(/-/g, ' ')
        .toUpperCase()
        .match(/[0-9]+[A-Z]?|BIS|SUR|ESTE/g);
      if (!rest?.length) return null;
      return [match[1], ...rest].join(' ');
    }
  }
  return null;
}

/** NIT "900.123.456-7" → { nit: "900123456", checkDigit: "7" } */
export function splitNit(
  value: string,
): { nit: string; checkDigit: string | null } | null {
  const [base, dv] = value.trim().split('-');
  const nit = (base ?? '').replace(/[\s.]/g, '');
  if (!/^\d{6,10}$/.test(nit)) return null;
  const checkDigit = dv?.trim() ?? null;
  if (checkDigit !== null && !/^\d$/.test(checkDigit)) return null;
  return { nit, checkDigit };
}

/** Dígito de verificación DIAN para un NIT. */
export function nitCheckDigit(nit: string): string {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = nit.split('').reverse();
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const mod = sum % 11;
  return String(mod > 1 ? 11 - mod : mod);
}

/** Matrícula inmobiliaria "50C-1234567" → "50C1234567" */
export function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}
