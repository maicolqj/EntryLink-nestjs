import { ConsoleLogger } from '@nestjs/common';

/**
 * Nombres de variables de entorno cuyo VALOR nunca debe aparecer en un log ni
 * en Sentry: llaves de R2, secretos de JWT, claves de la base, tokens de
 * WhatsApp, llaves HMAC de la Growth Suite, DSN de Sentry, etc.
 */
const SECRET_ENV_NAME =
  /(SECRET|PASSWORD|PASSDB|TOKEN|PRIVATE|_KEYS?$|ACCESS_KEY_ID|ACCOUNT_ID|DSN)/i;

/** Valores más cortos que esto no se buscan (evita tapar «true», «3000»…). */
const MIN_SECRET_LENGTH = 8;

const REDACTED = '[redactado]';

/** Valores de las variables secretas presentes en `env`, del más largo al más corto. */
export function secretValuesFrom(env: NodeJS.ProcessEnv): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || !SECRET_ENV_NAME.test(name)) continue;
    // Listas como GROWTH_SUPPRESSION_HMAC_KEYS («1:<llave>,2:<llave>»): cada
    // llave cuenta por separado, sin su número de versión.
    for (const part of [value, ...value.split(/[,;]/)]) {
      const v = part.replace(/^\s*\d+:/, '').trim();
      if (v.length >= MIN_SECRET_LENGTH) values.add(v);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Reemplaza cada aparición literal de un secreto por «[redactado]». */
export function redactSecrets(
  text: string,
  secrets: readonly string[],
): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

let cached: string[] | null = null;

/** `redactSecrets` con los secretos del proceso (se leen una vez). */
export function scrubSecrets(text: string): string {
  cached ??= secretValuesFrom(process.env);
  return redactSecrets(text, cached);
}

/** Solo para pruebas: vuelve a leer `process.env` en la próxima llamada. */
export function resetSecretScrubberForTests(): void {
  cached = null;
}

/**
 * Logger de la app: el de Nest, pero ningún mensaje ni traza sale con el
 * valor de una variable secreta, venga del servicio que venga. Es la red de
 * seguridad: la regla sigue siendo no loguear credenciales (como hacía
 * R2StorageService hasta el 2026-08-01).
 */
export class ScrubbingConsoleLogger extends ConsoleLogger {
  protected formatMessage(
    ...args: Parameters<ConsoleLogger['formatMessage']>
  ): string {
    return scrubSecrets(super.formatMessage(...args));
  }

  protected printStackTrace(stack: string): void {
    super.printStackTrace(stack ? scrubSecrets(stack) : stack);
  }
}
