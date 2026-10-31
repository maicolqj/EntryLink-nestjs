import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/** Mismo criterio que UniversalRolePermissionGuard: SUPER_ADMIN pasa siempre. */
export function actorHas(
  actor: JwtAccessPayload,
  permission: ValidPermissions,
): boolean {
  return (
    !!actor.roles?.includes(ValidRoles.SUPER_ADMIN_ROL) ||
    !!actor.permissions?.includes(permission)
  );
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
