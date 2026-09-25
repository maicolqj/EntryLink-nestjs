import { NotificationAudience } from '../enums/notification-audience.enum';
import { NotificationType } from '../enums/notification-type.enum';
import { RESIDENT_SESSION_ROLES } from '../../auth/constants/resident-session.constants';

/**
 * Con qué sombrero se lee cada tipo de notificación.
 *
 * El criterio es el destinatario que el tipo tiene en mente, no el módulo que
 * lo emite: `PET_INCIDENT_REPORTED` nace en mascotas pero lo lee la
 * administración, y `PET_WARNING_ISSUED` nace en el mismo sitio y lo lee la
 * unidad sancionada.
 *
 * `ANY` se reserva para tres casos y se usa lo menos posible, porque es el
 * único valor que deja pasar contenido a las dos bandejas:
 *   1. seguridad de la propia cuenta (un equipo nuevo, una aprobación de
 *      ingreso): esconderlo del residente rompería el flujo que lo protege;
 *   2. emergencias y comunicados del conjunto: ocultarlos puede costar caro;
 *   3. flujos cuyo destinatario es indistinto —quien reportó un daño en una
 *      zona común puede ser un vecino o el supervisor— y donde el contenido no
 *      revela nada que el residente no deba ver.
 *
 * El default de quien consulta es STAFF, no ANY: un tipo nuevo sin clasificar
 * se queda fuera de la app del residente hasta que alguien decida. Es preferible
 * que una notificación tarde en aparecer a que se filtre sola. La prueba de
 * exhaustividad impide que eso pase sin querer.
 */
export const NOTIFICATION_AUDIENCE: Record<
  NotificationType,
  NotificationAudience
> = {
  // ── Paquetes ────────────────────────────────────────────────────────────
  // Todo el ciclo es sobre la correspondencia de una unidad.
  [NotificationType.PACKAGE_RECEIVED]: NotificationAudience.RESIDENT,
  [NotificationType.PACKAGE_READY]: NotificationAudience.RESIDENT,
  [NotificationType.PACKAGE_DELIVERED]: NotificationAudience.RESIDENT,
  [NotificationType.PACKAGE_RETURNED]: NotificationAudience.RESIDENT,
  [NotificationType.PACKAGE_LOST]: NotificationAudience.RESIDENT,

  // ── Visitantes ──────────────────────────────────────────────────────────
  [NotificationType.VISITOR_WALK_IN]: NotificationAudience.RESIDENT,
  // Declarados pero sin emisor en todo el código: hoy nadie los manda. Se dejan
  // en STAFF por el default conservador; cuando se implementen habrá que mirar a
  // quién se le envían de verdad antes de moverlos.
  [NotificationType.VISIT_APPROVED]: NotificationAudience.STAFF,
  [NotificationType.VISIT_DENIED]: NotificationAudience.STAFF,
  [NotificationType.VISIT_REMINDER]: NotificationAudience.RESIDENT,
  [NotificationType.VISITOR_ARRIVED]: NotificationAudience.RESIDENT,
  // Una lista negra es una decisión de seguridad del conjunto.
  [NotificationType.VISITOR_BLACKLISTED]: NotificationAudience.STAFF,

  // ── Residentes ──────────────────────────────────────────────────────────
  [NotificationType.RESIDENT_APPROVED]: NotificationAudience.RESIDENT,
  [NotificationType.RESIDENT_REJECTED]: NotificationAudience.RESIDENT,
  [NotificationType.RESIDENT_PENDING]: NotificationAudience.STAFF,
  // Es sobre el acceso de la propia persona: tiene que llegarle donde entra.
  [NotificationType.ACCESS_CODE_RESET]: NotificationAudience.RESIDENT,

  // ── Parqueadero de visitantes ───────────────────────────────────────────
  [NotificationType.PARKING_ASSIGNED]: NotificationAudience.RESIDENT,

  // ── Vehículos ───────────────────────────────────────────────────────────
  [NotificationType.VEHICLE_REGISTERED]: NotificationAudience.RESIDENT,
  [NotificationType.VEHICLE_APPROVED]: NotificationAudience.RESIDENT,
  [NotificationType.VEHICLE_REJECTED]: NotificationAudience.RESIDENT,
  [NotificationType.VEHICLE_SUSPENDED]: NotificationAudience.RESIDENT,
  [NotificationType.VEHICLE_REACTIVATED]: NotificationAudience.RESIDENT,
  [NotificationType.VEHICLE_REMOVED]: NotificationAudience.RESIDENT,
  [NotificationType.VEHICLE_PENDING]: NotificationAudience.STAFF,

  // ── Finanzas ────────────────────────────────────────────────────────────
  // Todas se emiten contra una unidad concreta y hablan de su estado de cuenta.
  // Ninguna va a ANY: el movimiento financiero de una unidad no tiene por qué
  // aparecer en la bandeja operativa de quien además administra.
  [NotificationType.PAYMENT_DUE]: NotificationAudience.RESIDENT,
  [NotificationType.PAYMENT_OVERDUE]: NotificationAudience.RESIDENT,
  [NotificationType.PAYMENT_RECEIVED]: NotificationAudience.RESIDENT,
  [NotificationType.PAYMENT_CONFIRMED]: NotificationAudience.RESIDENT,
  [NotificationType.PAYMENT_REVERSED]: NotificationAudience.RESIDENT,
  [NotificationType.CHARGE_ADDED]: NotificationAudience.RESIDENT,
  [NotificationType.DIRECT_CHARGE]: NotificationAudience.RESIDENT,
  [NotificationType.CHARGE_WAIVED]: NotificationAudience.RESIDENT,
  [NotificationType.MORA_APPLIED]: NotificationAudience.RESIDENT,
  [NotificationType.WALLET_CREDIT]: NotificationAudience.RESIDENT,
  [NotificationType.WALLET_APPLIED]: NotificationAudience.RESIDENT,

  // ── Seguridad y emergencias ─────────────────────────────────────────────
  // El pánico lo disparan y lo reciben los dos lados. Filtrarlo por sombrero
  // sería la peor forma de ahorrar ruido.
  [NotificationType.PANIC_ALERT]: NotificationAudience.ANY,
  // La pide el residente; la atiende la portería.
  [NotificationType.SECURITY_CALL_REQUEST]: NotificationAudience.STAFF,

  // ── Comunicados del conjunto ────────────────────────────────────────────
  [NotificationType.SYSTEM_ANNOUNCEMENT]: NotificationAudience.ANY,
  [NotificationType.COMPLEX_ALERT]: NotificationAudience.ANY,
  [NotificationType.AMENITY_REMINDER]: NotificationAudience.RESIDENT,

  // ── Zonas comunes ───────────────────────────────────────────────────────
  [NotificationType.AMENITY_BOOKING_REQUESTED]: NotificationAudience.STAFF,
  [NotificationType.AMENITY_BOOKING_APPROVED]: NotificationAudience.RESIDENT,
  [NotificationType.AMENITY_BOOKING_REJECTED]: NotificationAudience.RESIDENT,
  // Las dos salen por `notifyResidents` y el cuerpo dice "Tu reserva": van a
  // quien reservó, no a la contraparte.
  [NotificationType.AMENITY_BOOKING_CANCELLED]: NotificationAudience.RESIDENT,
  [NotificationType.AMENITY_BOOKING_NO_SHOW]: NotificationAudience.RESIDENT,
  [NotificationType.AMENITY_DAMAGE_CHARGED]: NotificationAudience.RESIDENT,
  [NotificationType.AMENITY_CLEANING_UPDATED]: NotificationAudience.RESIDENT,
  [NotificationType.AMENITY_PAYMENT_RECEIVED]: NotificationAudience.RESIDENT,
  [NotificationType.AMENITY_REFUND_PAID]: NotificationAudience.RESIDENT,
  // Insumo para cobrar daños: es trabajo de la administración, no del residente.
  [NotificationType.AMENITY_BOOKING_NOVELTY]: NotificationAudience.STAFF,

  // ── PQRF y votaciones ───────────────────────────────────────────────────
  // El consejo es residente y a la vez instancia destinataria, y vota desde la
  // app. Marcarlos STAFF los dejaría sin su bandeja. Ver COUNCIL_ROL.
  [NotificationType.PQRF_RECEIVED]: NotificationAudience.ANY,
  [NotificationType.PQRF_RESOLVED]: NotificationAudience.ANY,
  [NotificationType.PQRF_REMINDER]: NotificationAudience.ANY,
  // Votar no: los destinatarios salen de `findCouncilUserIds` o de los
  // residentes activos del complejo. Unos y otros son residentes.
  [NotificationType.VOTING_OPENED]: NotificationAudience.RESIDENT,

  // ── Mascotas y convivencia ──────────────────────────────────────────────
  [NotificationType.PET_REGISTERED]: NotificationAudience.STAFF,
  [NotificationType.PET_APPROVED]: NotificationAudience.RESIDENT,
  [NotificationType.PET_REJECTED]: NotificationAudience.RESIDENT,
  [NotificationType.PET_SUSPENDED]: NotificationAudience.RESIDENT,
  [NotificationType.PET_REACTIVATED]: NotificationAudience.RESIDENT,
  // STAFF y no ANY a propósito: el reporte lleva quién acusó, y esa identidad
  // nunca puede llegarle al acusado. Es la garantía del módulo de mascotas.
  [NotificationType.PET_INCIDENT_REPORTED]: NotificationAudience.STAFF,
  [NotificationType.PET_INCIDENT_VALIDATED]: NotificationAudience.RESIDENT,
  [NotificationType.PET_INCIDENT_DISMISSED]: NotificationAudience.RESIDENT,
  [NotificationType.PET_WARNING_ISSUED]: NotificationAudience.RESIDENT,
  [NotificationType.PET_FINE_CHARGED]: NotificationAudience.RESIDENT,
  [NotificationType.PET_STATEMENT_RECEIVED]: NotificationAudience.STAFF,
  [NotificationType.PET_DOCUMENT_EXPIRING]: NotificationAudience.RESIDENT,
  [NotificationType.PET_REMOVED]: NotificationAudience.STAFF,

  // ── Mantenimiento de zonas comunes ──────────────────────────────────────
  [NotificationType.MAINTENANCE_TICKET_REPORTED]: NotificationAudience.STAFF,
  // Quien reportó el daño puede ser un vecino: el seguimiento tiene que
  // llegarle a la app donde lo radicó.
  [NotificationType.MAINTENANCE_TICKET_ASSIGNED]: NotificationAudience.ANY,
  [NotificationType.MAINTENANCE_TICKET_UPDATED]: NotificationAudience.ANY,
  [NotificationType.MAINTENANCE_TICKET_RESOLVED]: NotificationAudience.ANY,
  [NotificationType.MAINTENANCE_TICKET_REJECTED]: NotificationAudience.ANY,
  [NotificationType.MAINTENANCE_RATING_REQUESTED]: NotificationAudience.ANY,
  [NotificationType.MAINTENANCE_TICKET_REOPENED]: NotificationAudience.STAFF,
  // Va a la administración y, si es crítico, al consejo —que lee desde la app—.
  [NotificationType.MAINTENANCE_SLA_BREACHED]: NotificationAudience.ANY,

  // ── Clasificados ────────────────────────────────────────────────────────
  [NotificationType.LISTING_PENDING_REVIEW]: NotificationAudience.STAFF,
  [NotificationType.LISTING_APPROVED]: NotificationAudience.RESIDENT,
  [NotificationType.LISTING_REJECTED]: NotificationAudience.RESIDENT,
  [NotificationType.LISTING_INTEREST]: NotificationAudience.RESIDENT,
  // El chat es entre vecinos; sale solo como push.
  [NotificationType.MARKETPLACE_CHAT_MESSAGE]: NotificationAudience.RESIDENT,
  // Quién reportó un chat es dato de moderación.
  [NotificationType.MARKETPLACE_CHAT_REPORTED]: NotificationAudience.STAFF,
  [NotificationType.MARKETPLACE_CHAT_REPORT_RESOLVED]:
    NotificationAudience.RESIDENT,
  // Quién reportó un aviso es dato de moderación, no del vecino publicador.
  [NotificationType.LISTING_REPORTED]: NotificationAudience.STAFF,
  // Sale por `notifyOwner`: la recibe quien publicó, que es un vecino.
  [NotificationType.LISTING_PAUSED_BY_REPORTS]: NotificationAudience.RESIDENT,
  [NotificationType.LISTING_EXPIRING]: NotificationAudience.RESIDENT,
  [NotificationType.LISTING_EXPIRED]: NotificationAudience.RESIDENT,

  // ── Cuenta y seguridad del acceso ───────────────────────────────────────
  // Estas tres son de la cuenta, no del cargo. Si no llegan a la app del
  // residente, el aviso de un equipo nuevo pierde sentido y la aprobación de
  // ingreso desde otro dispositivo deja de funcionar.
  [NotificationType.PROFILE_UPDATED]: NotificationAudience.ANY,
  [NotificationType.NEW_DEVICE_LINKED]: NotificationAudience.ANY,
  [NotificationType.LOGIN_APPROVAL_REQUEST]: NotificationAudience.ANY,

  // ── Supervisores ────────────────────────────────────────────────────────
  [NotificationType.ACCESS_REQUEST_APPROVED]: NotificationAudience.STAFF,
  [NotificationType.ACCESS_REQUEST_REJECTED]: NotificationAudience.STAFF,
  [NotificationType.ACCESS_REVOKED_INACTIVITY]: NotificationAudience.STAFF,

  // ── Legal ───────────────────────────────────────────────────────────────
  [NotificationType.DPA_SIGNED]: NotificationAudience.STAFF,
  [NotificationType.DPA_APPROVED]: NotificationAudience.STAFF,
  [NotificationType.DPA_REJECTED]: NotificationAudience.STAFF,
};

/**
 * Audiencia de un tipo. Un tipo sin clasificar cae en STAFF: no se filtra solo
 * a la app del residente por un olvido.
 */
export function audienceOf(type: NotificationType): NotificationAudience {
  return NOTIFICATION_AUDIENCE[type] ?? NotificationAudience.STAFF;
}

/** Los tipos que una sesión de residente puede leer. */
export const RESIDENT_VISIBLE_AUDIENCES: readonly NotificationAudience[] = [
  NotificationAudience.RESIDENT,
  NotificationAudience.ANY,
];

/**
 * Los tipos concretos que ve una sesión de residente, para el `IN (...)` de la
 * consulta.
 *
 * Es una lista de permitidos y no de prohibidos a propósito: un tipo nuevo que
 * nadie clasificó queda fuera, que es el lado seguro del error. Con la lista
 * invertida entraría solo a la app sin que nadie lo decidiera.
 */
export const RESIDENT_VISIBLE_TYPES: readonly NotificationType[] =
  Object.values(NotificationType).filter((type) =>
    RESIDENT_VISIBLE_AUDIENCES.includes(audienceOf(type)),
  );

/**
 * ¿La sesión mira solo con el sombrero de residente?
 *
 * Se decide por los roles del token, no por un indicador aparte: los canales de
 * residente ya emiten sesiones acotadas a RESIDENT_SESSION_ROLES. Un residente
 * común también cae acá, y no cambia nada para él —nunca fue destinatario de
 * una notificación de operación—.
 */
export function isResidentOnlySession(roles?: readonly string[]): boolean {
  if (!roles?.length) return false;

  return roles.every((role) =>
    (RESIDENT_SESSION_ROLES as readonly string[]).includes(role),
  );
}
