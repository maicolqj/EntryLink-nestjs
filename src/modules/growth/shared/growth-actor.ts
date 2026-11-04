import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import {
  isPermissionInactive,
  isRoleInactive,
} from '../../shared/permission-status/permission-status.registry';

/**
 * Mismo criterio que UniversalRolePermissionGuard: un permiso inactivo no
 * autoriza a nadie, tampoco a SUPER_ADMIN (si lo necesita, primero se
 * activa). Con el permiso activo, SUPER_ADMIN pasa aunque no lo tenga en el
 * token; los demás lo necesitan en el token. El estado lo deja al día el
 * guard en cada operación; si no es confiable, todo permiso cuenta como
 * inactivo (falla cerrado).
 */
export function actorHas(
  actor: JwtAccessPayload,
  permission: ValidPermissions,
): boolean {
  if (isPermissionInactive(permission)) return false;
  if (
    actor.roles?.includes(ValidRoles.SUPER_ADMIN_ROL) &&
    !isRoleInactive(ValidRoles.SUPER_ADMIN_ROL)
  ) {
    return true;
  }
  return !!actor.permissions?.includes(permission);
}

/**
 * Diferencia apta para el registro de actividad. Solo los campos de
 * `safeFields` guardan su valor; cualquier otro campo que cambie queda como
 * "modificado", para no copiar datos personales a la auditoría.
 */
export function safeDiff<T extends object>(
  before: Partial<T> | null,
  after: Partial<T>,
  safeFields: (keyof T)[],
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after),
  ]) as Set<keyof T & string>;
  for (const key of keys) {
    const from = before?.[key];
    const to = after[key];
    if (to === undefined) continue;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    diff[key] = safeFields.includes(key)
      ? { from: from ?? null, to: to ?? null }
      : 'modificado';
  }
  return diff;
}

/** Copia solo los campos presentes: un `undefined` del input no pisa nada. */
export function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
