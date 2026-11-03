/**
 * Permisos inactivos conocidos por este proceso, para consultas síncronas
 * (`actorHas` de la Growth Suite y el guard). Lo mantiene
 * PermissionStatusService; aquí solo se guarda y se lee.
 *
 * Un permiso inactivo no autoriza nada aunque venga en un token emitido
 * antes de desactivarlo.
 */
let inactive: ReadonlySet<string> = new Set<string>();
let loadedAt = 0;
let loaded = false;

export function setInactivePermissions(
  names: Iterable<string>,
  at = Date.now(),
): void {
  inactive = new Set(names);
  loadedAt = at;
  loaded = true;
}

/** Vence lo cargado sin perderlo: la próxima consulta vuelve a leer. */
export function markInactivePermissionsStale(): void {
  loadedAt = 0;
}

/** Se cargó al menos una vez (aunque esté vencido). */
export function inactivePermissionsLoaded(): boolean {
  return loaded;
}

/** Posterga la próxima lectura sin cambiar lo conocido (tras un fallo). */
export function touchInactivePermissions(at = Date.now()): void {
  loadedAt = at;
}

export function inactivePermissions(): ReadonlySet<string> {
  return inactive;
}

export function inactivePermissionsLoadedAt(): number {
  return loadedAt;
}

export function isPermissionInactive(name: string): boolean {
  return inactive.has(name);
}

/** Solo para pruebas: vuelve al estado inicial (nada cargado). */
export function resetInactivePermissions(): void {
  inactive = new Set<string>();
  loadedAt = 0;
  loaded = false;
}
