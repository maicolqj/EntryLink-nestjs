/**
 * Construcción de rutas del bucket de R2.
 *
 * Vive fuera del servicio de Nest (y sin dependencias del framework) para que
 * el script de migración `scripts/migrate-r2-layout.ts` calcule exactamente las
 * mismas claves que genera la aplicación. Si esta lógica estuviera duplicada,
 * cualquier ajuste futuro dejaría archivos migrados a una ruta que la app ya no
 * usa — que es justo el problema que originó la doble carpeta raíz.
 */

/**
 * Carpeta usada cuando el archivo no pertenece a ningún complejo residencial
 * (documentos legales de la plataforma, tarjetas de empresa de supervisores que
 * todavía no están asignados, fotos de perfil de SUPER_ADMIN/COMPLIANCE).
 */
export const PLATFORM_SCOPE = '_platform';

/** Nombre canónico de la carpeta raíz cuando APPNAME no está definido. */
export const DEFAULT_APP_ROOT = 'EntryLink';

/** Limpia un segmento de ruta: sin barras propias ni espacios en los extremos. */
export function sanitizeSegment(segment: string | null | undefined): string {
  return (segment ?? '').trim().replace(/^\/+|\/+$/g, '');
}

/**
 * Carpeta raíz del bucket, normalizada. Las claves de R2 distinguen mayúsculas,
 * así que `entrylink/` y `EntryLink/` aparecerían como dos carpetas distintas
 * en el panel: la raíz debe ser idéntica en todos los entornos.
 */
export function resolveAppRoot(appName?: string | null): string {
  return sanitizeSegment(appName) || DEFAULT_APP_ROOT;
}

/**
 * Estructura única del bucket: `{appRoot}/{complexSlug}/{module}/{...subPaths}`
 * Si el archivo no pertenece a un complejo se agrupa bajo `{appRoot}/_platform`.
 *
 * @param appRoot     carpeta raíz ya resuelta (ver `resolveAppRoot`)
 * @param complexSlug slug del complejo dueño del archivo; null/undefined → `_platform`
 * @param module      módulo que produce el archivo (packages, notes, visitors…)
 */
export function buildFolderPath(
  appRoot: string,
  complexSlug: string | null | undefined,
  module: string,
  ...subPaths: string[]
): string {
  const scope = sanitizeSegment(complexSlug) || PLATFORM_SCOPE;

  return [appRoot, scope, module, ...subPaths]
    .map(segment => sanitizeSegment(segment))
    .filter(Boolean)
    .join('/');
}
