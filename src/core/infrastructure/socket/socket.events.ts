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

  /** Cambió algo en un ticket de mantenimiento: el tablero y el mapa se repintan. */
  MAINTENANCE_TICKET_UPDATED = 'maintenance:ticket:updated',

  // Resident bulk import
  RESIDENT_IMPORT_PROGRESS = 'resident:import:progress',
  RESIDENT_IMPORT_DONE = 'resident:import:done',
}
