import { registerEnumType } from '@nestjs/graphql';

/**
 * Tipos de notificación del sistema.
 * Cada tipo tiene su propia plantilla de título + cuerpo y determina
 * qué acción realiza la app al tocar la notificación (deep link).
 */
export enum NotificationType {
  // ── Paquetes / Correspondencia ─────────────────────────────────
  PACKAGE_RECEIVED = 'PACKAGE_RECEIVED', // Llegó un paquete a portería
  PACKAGE_READY = 'PACKAGE_READY', // Paquete listo para retirar
  PACKAGE_DELIVERED = 'PACKAGE_DELIVERED', // Paquete entregado (confirmación)
  PACKAGE_RETURNED = 'PACKAGE_RETURNED', // Paquete devuelto al remitente
  PACKAGE_LOST = 'PACKAGE_LOST', // Paquete reportado como perdido

  // ── Visitantes / Visitas ───────────────────────────────────────
  VISITOR_WALK_IN = 'VISITOR_WALK_IN', // Visitante walk-in esperando aprobación
  VISIT_APPROVED = 'VISIT_APPROVED', // Residente aprobó la visita
  VISIT_DENIED = 'VISIT_DENIED', // Residente denegó la visita
  VISIT_REMINDER = 'VISIT_REMINDER', // Recordatorio de visita agendada
  VISITOR_ARRIVED = 'VISITOR_ARRIVED', // Visitante pre-agendado llegó
  VISITOR_BLACKLISTED = 'VISITOR_BLACKLISTED', // Visitante agregado a la lista negra

  // ── Residentes ────────────────────────────────────────────────
  RESIDENT_APPROVED = 'RESIDENT_APPROVED', // Solicitud de residencia aprobada
  RESIDENT_REJECTED = 'RESIDENT_REJECTED', // Solicitud de residencia rechazada
  RESIDENT_PENDING = 'RESIDENT_PENDING', // Nueva solicitud de residencia (admin)
  ACCESS_CODE_RESET = 'ACCESS_CODE_RESET', // La administración borró la clave de acceso del residente

  // ── Parqueadero visitante ──────────────────────────────────────
  PARKING_ASSIGNED = 'PARKING_ASSIGNED', // Cargo de parqueadero visitante generado a la unidad

  // ── Vehículos ─────────────────────────────────────────────────
  VEHICLE_REGISTERED = 'VEHICLE_REGISTERED', // Vehículo registrado en la unidad
  VEHICLE_APPROVED = 'VEHICLE_APPROVED', // Vehículo aprobado
  VEHICLE_REJECTED = 'VEHICLE_REJECTED', // Vehículo rechazado
  VEHICLE_SUSPENDED = 'VEHICLE_SUSPENDED', // Vehículo suspendido
  VEHICLE_REACTIVATED = 'VEHICLE_REACTIVATED', // Vehículo reactivado
  VEHICLE_REMOVED = 'VEHICLE_REMOVED', // Vehículo retirado del complejo
  VEHICLE_PENDING = 'VEHICLE_PENDING', // Nuevo vehículo pendiente (admin)

  // ── Finanzas ──────────────────────────────────────────────────
  PAYMENT_DUE = 'PAYMENT_DUE', // Cuota próxima a vencer
  PAYMENT_OVERDUE = 'PAYMENT_OVERDUE', // Cuota vencida
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED', // Pago registrado
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED', // Pago confirmado (automático tras registrar pago)
  PAYMENT_REVERSED = 'PAYMENT_REVERSED', // Pago anulado en la unidad
  CHARGE_ADDED = 'CHARGE_ADDED', // Nuevo cargo generado en bulk
  DIRECT_CHARGE = 'DIRECT_CHARGE', // Cargo directo aplicado manualmente a una unidad
  CHARGE_WAIVED = 'CHARGE_WAIVED', // Cargo exonerado / cancelado a la unidad
  MORA_APPLIED = 'MORA_APPLIED', // Interés de mora aplicado a la unidad
  WALLET_CREDIT = 'WALLET_CREDIT', // Saldo a favor agregado a la unidad
  WALLET_APPLIED = 'WALLET_APPLIED', // Saldo a favor aplicado a un cargo

  // ── Seguridad / Emergencias ────────────────────────────────────
  PANIC_ALERT = 'PANIC_ALERT', // Alerta de pánico activada por residente o guardia
  SECURITY_CALL_REQUEST = 'SECURITY_CALL_REQUEST', // Residente pide que portería llame a su unidad

  // ── Sistema / Complejo ─────────────────────────────────────────
  SYSTEM_ANNOUNCEMENT = 'SYSTEM_ANNOUNCEMENT', // Comunicado general del complejo
  COMPLEX_ALERT = 'COMPLEX_ALERT', // Alerta de emergencia / corte de servicios
  AMENITY_REMINDER = 'AMENITY_REMINDER', // Recordatorio de reserva de zona común

  // ── Zonas comunes / Reservas ───────────────────────────────────
  AMENITY_BOOKING_REQUESTED = 'AMENITY_BOOKING_REQUESTED', // Nueva reserva pendiente de aprobación (admin)

  PQRF_RECEIVED = 'PQRF_RECEIVED', // Radicado nuevo para la instancia destinataria
  PQRF_RESOLVED = 'PQRF_RESOLVED', // Todos los destinatarios marcaron el radicado como resuelto
  PQRF_REMINDER = 'PQRF_REMINDER', // Al radicado le queda poco para vencerse
  VOTING_OPENED = 'VOTING_OPENED', // Se abrió una pregunta en la que el usuario puede votar
  AMENITY_BOOKING_APPROVED = 'AMENITY_BOOKING_APPROVED', // Reserva aprobada (residente)
  AMENITY_BOOKING_REJECTED = 'AMENITY_BOOKING_REJECTED', // Reserva rechazada (residente)
  AMENITY_BOOKING_CANCELLED = 'AMENITY_BOOKING_CANCELLED', // Reserva cancelada (contraparte)
  AMENITY_BOOKING_NO_SHOW = 'AMENITY_BOOKING_NO_SHOW', // La reserva venció sin que nadie ingresara
  AMENITY_DAMAGE_CHARGED = 'AMENITY_DAMAGE_CHARGED', // Se cargó a la unidad un valor por daños en la zona
  AMENITY_CLEANING_UPDATED = 'AMENITY_CLEANING_UPDATED', // La administración cambió el aseo de la reserva
  AMENITY_PAYMENT_RECEIVED = 'AMENITY_PAYMENT_RECEIVED', // La administración recibió el pago del alquiler
  AMENITY_REFUND_PAID = 'AMENITY_REFUND_PAID', // Se le entregó la devolución por una reserva cancelada

  // ── Mascotas y convivencia ─────────────────────────────────────
  PET_REGISTERED = 'PET_REGISTERED', // Ficha nueva pendiente de validar (admin)
  PET_APPROVED = 'PET_APPROVED', // Ficha aprobada (unidad)
  PET_REJECTED = 'PET_REJECTED', // Ficha rechazada (unidad)
  PET_SUSPENDED = 'PET_SUSPENDED', // Autorización suspendida (unidad)
  PET_REACTIVATED = 'PET_REACTIVATED', // Autorización restablecida (unidad)
  PET_INCIDENT_REPORTED = 'PET_INCIDENT_REPORTED', // Reporte nuevo (admin y portería)
  PET_INCIDENT_VALIDATED = 'PET_INCIDENT_VALIDATED', // Reporte validado: corre el plazo de descargos (unidad)
  PET_INCIDENT_DISMISSED = 'PET_INCIDENT_DISMISSED', // Reporte desestimado (unidad)
  PET_WARNING_ISSUED = 'PET_WARNING_ISSUED', // Llamado de atención (unidad)
  PET_FINE_CHARGED = 'PET_FINE_CHARGED', // Multa cargada a la unidad
  PET_STATEMENT_RECEIVED = 'PET_STATEMENT_RECEIVED', // La unidad presentó descargos (admin)
  PET_DOCUMENT_EXPIRING = 'PET_DOCUMENT_EXPIRING', // Vence la vacuna antirrábica o la póliza
  PET_REMOVED = 'PET_REMOVED', // Ficha eliminada o retirada del censo (admin)

  // ── Mantenimiento de zonas comunes ─────────────────────────────
  MAINTENANCE_TICKET_REPORTED = 'MAINTENANCE_TICKET_REPORTED', // Reporte nuevo (admin y supervisor)
  MAINTENANCE_TICKET_ASSIGNED = 'MAINTENANCE_TICKET_ASSIGNED', // Ya hay responsable (reportante y asignado)
  MAINTENANCE_TICKET_UPDATED = 'MAINTENANCE_TICKET_UPDATED', // Cambió el estado o hay novedad (reportante)
  MAINTENANCE_TICKET_RESOLVED = 'MAINTENANCE_TICKET_RESOLVED', // Reparado: falta confirmar y calificar
  MAINTENANCE_TICKET_REJECTED = 'MAINTENANCE_TICKET_REJECTED', // El reporte no procede, con motivo
  MAINTENANCE_TICKET_REOPENED = 'MAINTENANCE_TICKET_REOPENED', // El arreglo no sirvió (admin)
  MAINTENANCE_SLA_BREACHED = 'MAINTENANCE_SLA_BREACHED', // Se venció el plazo comprometido (admin, consejo si es crítico)
  MAINTENANCE_RATING_REQUESTED = 'MAINTENANCE_RATING_REQUESTED', // Recordatorio de calificación (reportante)

  // ── Clasificados y comercio interno ────────────────────────────
  LISTING_PENDING_REVIEW = 'LISTING_PENDING_REVIEW', // Publicación esperando aprobación (admin)
  LISTING_APPROVED = 'LISTING_APPROVED', // Ya está visible en la vitrina (publicador)
  LISTING_REJECTED = 'LISTING_REJECTED', // No se aprobó, con motivo (publicador)
  LISTING_INTEREST = 'LISTING_INTEREST', // Alguien pulsó "me interesa" (publicador)
  MARKETPLACE_CHAT_MESSAGE = 'MARKETPLACE_CHAT_MESSAGE', // Mensaje nuevo en el chat de un aviso (solo push)
  MARKETPLACE_CHAT_REPORTED = 'MARKETPLACE_CHAT_REPORTED', // Un vecino reportó una conversación (admin)
  MARKETPLACE_CHAT_REPORT_RESOLVED = 'MARKETPLACE_CHAT_REPORT_RESOLVED', // Se revisó el reporte (quien reportó)
  LISTING_REPORTED = 'LISTING_REPORTED', // Un vecino reportó una publicación (admin)
  LISTING_PAUSED_BY_REPORTS = 'LISTING_PAUSED_BY_REPORTS', // Se ocultó sola por reportes (publicador y admin)
  LISTING_EXPIRING = 'LISTING_EXPIRING', // Vence la vigencia: renovar o dejarla caer (publicador)
  LISTING_EXPIRED = 'LISTING_EXPIRED', // Venció y salió de la vitrina (publicador)

  // ── Cuenta / Perfil ────────────────────────────────────────────
  PROFILE_UPDATED = 'PROFILE_UPDATED', // Datos personales del usuario modificados
  NEW_DEVICE_LINKED = 'NEW_DEVICE_LINKED', // Un equipo nuevo se vinculó con documento + clave (aviso de seguridad)
  LOGIN_APPROVAL_REQUEST = 'LOGIN_APPROVAL_REQUEST', // Alguien pide entrar a la cuenta: aprobar desde un dispositivo confiable

  // ── Supervisores / Solicitudes de acceso ───────────────────────
  ACCESS_REQUEST_APPROVED = 'ACCESS_REQUEST_APPROVED', // Solicitud de acceso aprobada por el admin
  ACCESS_REQUEST_REJECTED = 'ACCESS_REQUEST_REJECTED', // Solicitud de acceso rechazada por el admin
  ACCESS_REVOKED_INACTIVITY = 'ACCESS_REVOKED_INACTIVITY', // Acceso revocado por 30 días sin check-in

  // ── Legal / Documentos ─────────────────────────────────────────
  DPA_SIGNED = 'DPA_SIGNED', // Un complejo subió su DPA (Anexo B2B) firmado (aviso a SUPER_ADMIN)
  DPA_APPROVED = 'DPA_APPROVED', // El SUPER_ADMIN validó el DPA firmado (aviso al complejo)
  DPA_REJECTED = 'DPA_REJECTED', // El SUPER_ADMIN rechazó el DPA firmado (aviso al complejo, con motivo)
}

registerEnumType(NotificationType, {
  name: 'NotificationType',
  description: 'Tipo de evento que originó la notificación',
});
