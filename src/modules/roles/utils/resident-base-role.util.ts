import { EntityManager } from 'typeorm';

import { Role } from '../entities/role.entity';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { ValidRoles } from '../enums/valid-roles';

/**
 * RESIDENT_ROL es el rol BASE de la plataforma: se suma a cualquier otro, no lo
 * reemplaza. Quien administra, supervisa, lleva la contabilidad o cuida la
 * portería también puede vivir en un complejo, y en ese caso necesita la app de
 * residente igual que cualquier vecino.
 *
 * Estos son los roles que lo llevan además del suyo. Quedan fuera a propósito:
 *
 *   - COMPLEX_ROL     la cuenta del complejo no es un usuario; su JWT lleva el
 *                     id del complejo como `sub` y no tiene fila en `users`.
 *   - MAINTENANCE_ROL el personal de aseo y mantenimiento todavía no inicia
 *                     sesión.
 *   - COUNCIL_ROL     ya es un rol adicional del residente: quien lo tiene ya
 *                     trae RESIDENT_ROL.
 */
export const ROLES_WITH_RESIDENT_BASE: readonly ValidRoles[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
  ValidRoles.ACCOUNTANT_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
];

/** ¿Este rol arrastra RESIDENT_ROL como base? */
export function roleNeedsResidentBase(role: ValidRoles | string): boolean {
  return ROLES_WITH_RESIDENT_BASE.includes(role as ValidRoles);
}

/**
 * Garantiza que el usuario tenga RESIDENT_ROL. Idempotente: si ya lo tiene no
 * hace nada, así que sirve igual para el alta, para vincular una cuenta vieja a
 * una unidad y para reparar datos.
 *
 * `isPrimary` se marca solo cuando la cuenta no tenía ningún otro rol. Para
 * quien administra y además reside, el rol principal sigue siendo el suyo: es
 * el que decide a dónde entra al iniciar sesión con correo y contraseña.
 *
 * Devuelve `true` si tuvo que crear la relación.
 */
export async function ensureResidentRole(
  manager: EntityManager,
  userId: string,
  residentRoleId?: string,
): Promise<boolean> {
  const roleId = residentRoleId ?? (await resolveResidentRoleId(manager));

  const existing = await manager.findOne(UserRole, {
    where: { user: { id: userId }, role: { id: roleId } },
  });

  if (existing) return false;

  const otherRoles = await manager.count(UserRole, {
    where: { user: { id: userId } },
  });

  await manager.save(
    manager.create(UserRole, {
      user: { id: userId },
      role: { id: roleId },
      isPrimary: otherRoles === 0,
    }),
  );

  return true;
}

/** El id de RESIDENT_ROL, o un error claro si el seed de roles no corrió. */
export async function resolveResidentRoleId(
  manager: EntityManager,
): Promise<string> {
  const role = await manager.findOne(Role, {
    where: { name: ValidRoles.RESIDENT_ROL },
  });

  if (!role) {
    throw new Error(
      `El rol '${ValidRoles.RESIDENT_ROL}' no está configurado en el sistema`,
    );
  }

  return role.id;
}
