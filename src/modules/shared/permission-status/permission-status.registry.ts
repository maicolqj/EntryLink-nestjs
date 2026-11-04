/**
 * Permisos inactivos conocidos por este proceso, para consultas síncronas
 * (`actorHas` de la Growth Suite y el guard). Lo mantiene
 * PermissionStatusService; aquí solo se guarda y se lee.
 *
 * Un permiso inactivo no autoriza nada aunque venga en un token emitido
 * antes de desactivarlo. Y un estado que no se pudo verificar en
 * `PERMISSION_STATUS_MAX_STALE_MS` deja de ser confiable: todo permiso se
 * trata como no verificable y se niega (falla cerrado).
 *
 * Cada proceso (réplica) tiene su propio registro.
 */

/** Pasado este tiempo sin una lectura exitosa, el estado no autoriza nada. */
export const PERMISSION_STATUS_MAX_STALE_MS = 120_000;

let inactive: ReadonlySet<string> = new Set<string>();
/** Última lectura exitosa de la base (0 = nunca). */
let verifiedAt = 0;
/** Último intento, exitoso o no (para no reintentar en cada petición). */
let checkedAt = 0;
/** Pidieron releer (un cambio hecho con el servicio): no esperar al TTL. */
let refreshRequested = false;

export function setInactivePermissions(
  names: Iterable<string>,
  at = Date.now(),
): void {
  inactive = new Set(names);
  verifiedAt = at;
  checkedAt = at;
  refreshRequested = false;
}

/** Un intento fallido: se conserva lo conocido, pero no se rejuvenece. */
export function recordFailedCheck(at = Date.now()): void {
  checkedAt = at;
}

export function requestPermissionStatusRefresh(): void {
  refreshRequested = true;
}

export function permissionStatusRefreshRequested(): boolean {
  return refreshRequested;
}

export function inactivePermissions(): ReadonlySet<string> {
  return inactive;
}

export function permissionStatusVerifiedAt(): number {
  return verifiedAt;
}

export function permissionStatusCheckedAt(): number {
  return checkedAt;
}

/** El estado se verificó hace menos de la antigüedad máxima. */
export function permissionStatusTrusted(now = Date.now()): boolean {
  return verifiedAt > 0 && now - verifiedAt < PERMISSION_STATUS_MAX_STALE_MS;
}

/**
 * Para `actorHas`: un permiso inactivo, o cualquier permiso si el estado no
 * es confiable (nunca se leyó, o la base no responde hace más de la
 * antigüedad máxima), cuenta como no disponible.
 */
export function isPermissionInactive(name: string, now = Date.now()): boolean {
  if (!permissionStatusTrusted(now)) return true;
  return inactive.has(name);
}

/**
 * Solo para pruebas (setupFiles de jest): todos los permisos activos y un
 * estado que no vence, sin levantar PermissionStatusService. Las pruebas del
 * estado lo reinician con `resetInactivePermissions()`. Nunca en producción.
 */
export function trustPermissionStatusForTests(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('trustPermissionStatusForTests no se usa en producción');
  }
  inactive = new Set<string>();
  verifiedAt = Number.MAX_SAFE_INTEGER;
  checkedAt = Number.MAX_SAFE_INTEGER;
  refreshRequested = false;
}

/** Solo para pruebas: vuelve al estado inicial (nada cargado). */
export function resetInactivePermissions(): void {
  inactive = new Set<string>();
  verifiedAt = 0;
  checkedAt = 0;
  refreshRequested = false;
}
