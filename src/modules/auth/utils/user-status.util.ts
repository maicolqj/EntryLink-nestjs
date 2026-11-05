import { UserStatus } from '../../users/enums/user.enums';

/**
 * Una cuenta de usuario solo opera con `status = active`, igual que exige
 * cada canal de inicio de sesión. Suspendida, baneada, inactiva, pendiente de
 * verificar o eliminada: la sesión ya abierta tampoco sirve, ni para pedir
 * datos ni para renovarse.
 */
export function isUserStatusOperable(status: UserStatus | undefined): boolean {
  return status === UserStatus.ACTIVE;
}
