import * as Sentry from '@sentry/nestjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { redactValues } from './core/config/redact';
import { scrubSecrets } from './core/config/secret-scrubber';

/**
 * Sentry arranca antes que Nest (primer import de main.ts) para instrumentar
 * http, express, GraphQL, TypeORM/pg y Redis desde el inicio.
 *
 * Sin `SENTRY_DSN` no se envía nada (local, tests). Nunca se mandan datos
 * personales: solo el id del usuario y su conjunto, y se limpian cabeceras,
 * cookies y cuerpos de las peticiones (Habeas Data).
 */
const dsn = process.env.SENTRY_DSN;

function appVersion(): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'x-device-id',
  'x-api-key',
  'x-hub-signature-256',
];

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment:
    process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: appVersion() ? `entrylink-api@${appVersion()}` : undefined,
  // Nada de datos personales: sin cuerpos, variables GraphQL, parámetros de
  // SQL, argumentos de colas ni variables locales. El id del usuario lo pone
  // el filtro de errores a mano.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { deny: SENSITIVE_HEADERS }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: true, variables: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  // 10% de las transacciones en producción; ajustable sin desplegar código.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  beforeSend(event) {
    // Defensa adicional: un mensaje con «with value "…"» (estilo Joi) nunca
    // sale con el valor, y ningún texto lleva el valor de una variable
    // secreta (R2, JWT, base, tokens…), venga de donde venga.
    for (const ex of event.exception?.values ?? []) {
      if (ex.value) ex.value = scrubSecrets(redactValues(ex.value));
    }
    if (event.message)
      event.message = scrubSecrets(redactValues(event.message));
    for (const crumb of event.breadcrumbs ?? []) {
      if (crumb.message) crumb.message = scrubSecrets(crumb.message);
    }
    const request = event.request;
    if (request) {
      delete request.cookies;
      delete request.data;
      if (request.headers) {
        for (const header of SENSITIVE_HEADERS) delete request.headers[header];
      }
    }
    return event;
  },
  // Las migas (logs de consola, peticiones) también pasan por el depurador.
  beforeBreadcrumb(crumb) {
    if (crumb.message) crumb.message = scrubSecrets(crumb.message);
    return crumb;
  },
});
