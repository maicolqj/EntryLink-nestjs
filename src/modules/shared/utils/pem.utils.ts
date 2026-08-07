export const PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
export const PEM_FOOTER = '-----END PRIVATE KEY-----';

/**
 * Repara un PEM que pasó por un campo de texto de un panel de despliegue.
 *
 * Los saltos de línea de un PEM son significativos, y cada panel los maltrata a
 * su manera. Los cuatro daños vistos en producción, todos con el mismo error de
 * OpenSSL (`DECODER routines::unsupported`) y por tanto indistinguibles desde el
 * mensaje:
 *
 *  1. comillas del JSON incluidas en el valor,
 *  2. `\n` literales sin convertir (el caso clásico),
 *  3. barras dobladas (`\\n`) por un escapado de más,
 *  4. saltos borrados: la llave entera en una sola línea.
 *
 * Los tres primeros son sustituciones. El cuarto necesita reconstruir el
 * troquelado, porque un PEM sin saltos internos no lo acepta ningún parser.
 *
 * Preferir siempre base64 (FIREBASE_PRIVATE_KEY_BASE64) sobre confiar en esta
 * reparación: lo de aquí es una red de seguridad, no una garantía.
 */
export function normalizePem(raw: string): string {
  let key = raw.trim();

  // 1. Comillas envolventes.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  // 2 y 3. Primero deshacer el escapado doble, luego convertir los `\n`
  // literales. En este orden: al revés, `\\n` dejaría una barra suelta dentro
  // del cuerpo — que es exactamente el daño que se intenta reparar.
  key = key.replace(/\\\\n/g, '\\n').replace(/\\n/g, '\n').replace(/\r/g, '');

  // 4. Sin saltos internos no hay PEM válido: reconstruirlo.
  const body = extractBody(key);
  if (body && !hasWrappedBody(key)) {
    return `${PEM_HEADER}\n${wrap(body, 64)}\n${PEM_FOOTER}\n`;
  }

  // Los parsers toleran la ausencia del salto final, pero no cuesta nada dejarlo
  // como lo escribe la propia consola de Google.
  return key.endsWith('\n') ? key : `${key}\n`;
}

/** El base64 entre cabecera y pie, sin espacios ni saltos. Null si no hay PEM. */
function extractBody(key: string): string | null {
  const start = key.indexOf(PEM_HEADER);
  const end = key.indexOf(PEM_FOOTER);
  if (start === -1 || end === -1 || end <= start) return null;
  return key.slice(start + PEM_HEADER.length, end).replace(/\s+/g, '');
}

/** ¿El cuerpo ya viene troquelado en líneas? */
function hasWrappedBody(key: string): boolean {
  const start = key.indexOf(PEM_HEADER);
  const end = key.indexOf(PEM_FOOTER);
  if (start === -1 || end === -1) return false;
  return key.slice(start + PEM_HEADER.length, end).includes('\n');
}

function wrap(body: string, width: number): string {
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += width) {
    lines.push(body.slice(i, i + width));
  }
  return lines.join('\n');
}
