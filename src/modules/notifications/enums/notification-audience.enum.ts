import { registerEnumType } from '@nestjs/graphql';

/**
 * Con qué sombrero se lee una notificación.
 *
 * Una misma persona puede administrar el conjunto y vivir en él —ver
 * RESIDENT_SESSION_ROLES—, y la bandeja se direcciona por `recipientUserId`,
 * así que sin este eje devuelve TODO lo dirigido a esa persona sin importar
 * desde dónde esté mirando. En la app del residente eso significa ver cobros de
 * otras unidades, radicados contra la administración o quién reportó a quién.
 */
export enum NotificationAudience {
  /** Le concierne a la unidad: su paquete, su cuota, su mascota, su reserva. */
  RESIDENT = 'RESIDENT',
  /** Operación del conjunto: administración, portería, supervisión, contabilidad. */
  STAFF = 'STAFF',
  /**
   * Se lee igual con cualquier sombrero. Son tres casos y ninguno más:
   * seguridad de la propia cuenta, emergencias, y los flujos donde el
   * destinatario puede ser cualquiera de los dos (quien reporta un daño, el
   * consejo que es residente y a la vez instancia).
   */
  ANY = 'ANY',
}

registerEnumType(NotificationAudience, {
  name: 'NotificationAudience',
  description: 'Con qué rol se lee una notificación',
});
