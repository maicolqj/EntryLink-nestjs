import { SetMetadata } from '@nestjs/common';

import { ALLOW_WHEN_SUSPENDED_KEY } from '../guards/subscription.guard';

/**
 * Deja la operación (o toda la clase) disponible aunque la suscripción del
 * conjunto esté suspendida. Para lo que nunca debe apagarse por una deuda:
 * pánico, sesión, notificaciones y la propia renovación.
 */
export const AllowWhenSuspended = () =>
  SetMetadata(ALLOW_WHEN_SUSPENDED_KEY, true);
