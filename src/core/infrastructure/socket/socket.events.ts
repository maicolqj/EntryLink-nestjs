export enum SocketEvent {
  // Notifications
  NOTIFICATION_NEW            = 'notification:new',

  // Visitors
  VISITOR_ENTRY               = 'visitor:entry',
  VISITOR_EXIT                = 'visitor:exit',
  VISITOR_APPROVED            = 'visitor:approved',
  VISITOR_DENIED              = 'visitor:denied',

  // Packages
  PACKAGE_REGISTERED          = 'package:registered',
  PACKAGE_READY               = 'package:ready',
  PACKAGE_DELIVERED           = 'package:delivered',

  // Finance
  FINANCE_CHARGE_NEW          = 'finance:charge:new',
  FINANCE_PAYMENT_REGISTERED  = 'finance:payment:registered',

  // Panic
  PANIC_ALERT_NEW             = 'panic:alert:new',
  PANIC_ALERT_ACKNOWLEDGED    = 'panic:alert:acknowledged',

  // Amenities / Reservas de zonas comunes
  AMENITY_BOOKING_REQUESTED   = 'amenity:booking:requested',
  AMENITY_BOOKING_UPDATED     = 'amenity:booking:updated',
  AMENITY_BOOKING_CHECKED_IN  = 'amenity:booking:checkedIn',

  /** Cambió el estado de un radicado PQRF (abierto o resuelto). */
  PQRF_UPDATED                = 'pqrf:updated',

  /** Llegó un voto o cambió el estado de una pregunta: las gráficas se repintan. */
  VOTING_UPDATED              = 'voting:updated',

  /** Las votaciones se volvieron visibles —o dejaron de serlo— para los residentes. */
  VOTING_AVAILABILITY         = 'voting:availability',

  // Resident bulk import
  RESIDENT_IMPORT_PROGRESS    = 'resident:import:progress',
  RESIDENT_IMPORT_DONE        = 'resident:import:done',
}
