export enum SocketEvent {
  // Notifications
  NOTIFICATION_NEW = 'notification:new',

  // Visitors
  VISITOR_ENTRY = 'visitor:entry',
  VISITOR_EXIT = 'visitor:exit',
  VISITOR_APPROVED = 'visitor:approved',
  VISITOR_DENIED = 'visitor:denied',

  // Packages
  PACKAGE_REGISTERED = 'package:registered',
  PACKAGE_READY = 'package:ready',
  PACKAGE_DELIVERED = 'package:delivered',

  // Finance
  FINANCE_CHARGE_NEW = 'finance:charge:new',
  FINANCE_PAYMENT_REGISTERED = 'finance:payment:registered',

  // Panic
  PANIC_ALERT_NEW = 'panic:alert:new',
  PANIC_ALERT_ACKNOWLEDGED = 'panic:alert:acknowledged',
  /** Llegó (o mejoró) la ubicación de quien activó la alerta. */
  PANIC_ALERT_LOCATION = 'panic:alert:location',

  // Amenities / Reservas de zonas comunes
  AMENITY_BOOKING_REQUESTED = 'amenity:booking:requested',
  AMENITY_BOOKING_UPDATED = 'amenity:booking:updated',
  AMENITY_BOOKING_CHECKED_IN = 'amenity:booking:checkedIn',

  /** Cambió el estado de un radicado PQRF (abierto o resuelto). */
  PQRF_UPDATED = 'pqrf:updated',

  /** Llegó un voto o cambió el estado de una pregunta: las gráficas se repintan. */
  VOTING_UPDATED = 'voting:updated',

  /** Las votaciones se volvieron visibles —o dejaron de serlo— para los residentes. */
  VOTING_AVAILABILITY = 'voting:availability',

  /** Cambió el estado de un reporte de convivencia: el tablero se repinta. */
  PET_INCIDENT_UPDATED = 'pet:incident:updated',

  /**
   * El SUPER_ADMIN prendió o apagó módulos de un complejo.
   *
   * Va a la sala del complejo, donde están TODOS sus clientes conectados —la
   * administración en la web y los residentes en la app—, porque el menú de
   * ambos se arma con la misma lista. Sin esto, apagar finanzas deja la opción
   * visible hasta que cada quien cierre sesión, y el que entre se lleva un
   * error en vez de una pantalla.
   */
  COMPLEX_MODULES_UPDATED = 'complex:modules:updated',

  /**
   * El SUPER_ADMIN suspendió o reactivó un complejo.
   *
   * Va a la sala del complejo con `{ complexId, status, reason, suspendedAt }`.
   * Solo la web de la administración actúa: con SUSPENDED se va a la pantalla
   * de suspensión, y al reactivarse sale de ella. Residentes y portería lo
   * ignoran, la suspensión no los toca.
   */
  COMPLEX_STATUS_CHANGED = 'complex:status:changed',

  /** Cambió algo en un ticket de mantenimiento: el tablero y el mapa se repintan. */
  MAINTENANCE_TICKET_UPDATED = 'maintenance:ticket:updated',

  /**
   * Cambió el estado de una publicación de clasificados.
   *
   * Va a la sala del complejo: la misma vitrina la miran el residente en la app
   * y quien modera en la web, y lo que se aprueba tiene que aparecer sin que
   * nadie recargue.
   */
  MARKETPLACE_LISTING_UPDATED = 'marketplace:listing:updated',
  /** Mensaje nuevo en un chat de clasificados. Solo a los dos participantes. */
  MARKETPLACE_CHAT_MESSAGE = 'marketplace:chat:message',
  /** El otro leyó la conversación: para el "visto". */
  MARKETPLACE_CHAT_READ = 'marketplace:chat:read',

  /**
   * Un vigilante sacó la app de portería a segundo plano o volvió a ella.
   *
   * Va a la sala del complejo solo con `{ complexId }`: ahí también están los
   * residentes, y quién salió de la app lo lee la administración con la query
   * protegida. La web vuelve a pedir el listado.
   */
  SECURITY_APP_EXIT_UPDATED = 'security:app-exit:updated',

  // Citofonía por internet. Van a `user:{id}`: solo a las partes de la llamada.
  /** Una llamada entra: suena en los equipos de quien la recibe. */
  INTERCOM_CALL_INCOMING = 'intercom:call:incoming',
  /** Quien recibe contestó: el que llama arma la oferta WebRTC. */
  INTERCOM_CALL_ACCEPTED = 'intercom:call:accepted',
  /** La llamada terminó (colgada, rechazada, perdida o tomada por otro equipo). */
  INTERCOM_CALL_ENDED = 'intercom:call:ended',
  /** Oferta, respuesta o candidato ICE de la otra parte, tal cual. */
  INTERCOM_SIGNAL = 'intercom:signal',
  /** El SUPER_ADMIN cambió la citofonía del conjunto. Va a la sala del complejo. */
  INTERCOM_SETTINGS_UPDATED = 'intercom:settings:updated',

  /**
   * Se creó, cambió o borró una portería. Va a la sala del complejo: el
   * residente la elige y el vigilante dice en cuál está.
   */
  SECURITY_POSTS_UPDATED = 'security:posts:updated',

  // Resident bulk import
  RESIDENT_IMPORT_PROGRESS = 'resident:import:progress',
  RESIDENT_IMPORT_DONE = 'resident:import:done',
}
