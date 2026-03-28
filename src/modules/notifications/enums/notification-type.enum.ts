import { registerEnumType } from '@nestjs/graphql';

/**
 * Tipos de notificación del sistema.
 * Cada tipo tiene su propia plantilla de título + cuerpo y determina
 * qué acción realiza la app al tocar la notificación (deep link).
 */
export enum NotificationType {

  // ── Paquetes / Correspondencia ─────────────────────────────────
  PACKAGE_RECEIVED       = 'PACKAGE_RECEIVED',      // Llegó un paquete a portería
  PACKAGE_READY          = 'PACKAGE_READY',          // Paquete listo para retirar
  PACKAGE_DELIVERED      = 'PACKAGE_DELIVERED',      // Paquete entregado (confirmación)
  PACKAGE_RETURNED       = 'PACKAGE_RETURNED',       // Paquete devuelto al remitente

  // ── Visitantes / Visitas ───────────────────────────────────────
  VISITOR_WALK_IN        = 'VISITOR_WALK_IN',        // Visitante walk-in esperando aprobación
  VISIT_APPROVED         = 'VISIT_APPROVED',         // Residente aprobó la visita
  VISIT_DENIED           = 'VISIT_DENIED',           // Residente denegó la visita
  VISIT_REMINDER         = 'VISIT_REMINDER',         // Recordatorio de visita agendada
  VISITOR_ARRIVED        = 'VISITOR_ARRIVED',        // Visitante pre-agendado llegó

  // ── Residentes ────────────────────────────────────────────────
  RESIDENT_APPROVED      = 'RESIDENT_APPROVED',      // Solicitud de residencia aprobada
  RESIDENT_REJECTED      = 'RESIDENT_REJECTED',      // Solicitud de residencia rechazada
  RESIDENT_PENDING       = 'RESIDENT_PENDING',       // Nueva solicitud de residencia (admin)

  // ── Parqueadero visitante ──────────────────────────────────────
  PARKING_ASSIGNED       = 'PARKING_ASSIGNED',       // Cargo de parqueadero visitante generado a la unidad

  // ── Vehículos ─────────────────────────────────────────────────
  VEHICLE_APPROVED       = 'VEHICLE_APPROVED',       // Vehículo aprobado
  VEHICLE_REJECTED       = 'VEHICLE_REJECTED',       // Vehículo rechazado
  VEHICLE_SUSPENDED      = 'VEHICLE_SUSPENDED',      // Vehículo suspendido
  VEHICLE_PENDING        = 'VEHICLE_PENDING',        // Nuevo vehículo pendiente (admin)

  // ── Finanzas ──────────────────────────────────────────────────
  PAYMENT_DUE            = 'PAYMENT_DUE',            // Cuota próxima a vencer
  PAYMENT_OVERDUE        = 'PAYMENT_OVERDUE',        // Cuota vencida
  PAYMENT_RECEIVED       = 'PAYMENT_RECEIVED',       // Pago registrado
  PAYMENT_CONFIRMED      = 'PAYMENT_CONFIRMED',      // Pago confirmado (automático tras registrar pago)
  CHARGE_ADDED           = 'CHARGE_ADDED',           // Nuevo cargo generado en bulk
  DIRECT_CHARGE          = 'DIRECT_CHARGE',          // Cargo directo aplicado manualmente a una unidad

  // ── Seguridad / Emergencias ────────────────────────────────────
  PANIC_ALERT            = 'PANIC_ALERT',            // Alerta de pánico activada por residente o guardia

  // ── Sistema / Complejo ─────────────────────────────────────────
  SYSTEM_ANNOUNCEMENT    = 'SYSTEM_ANNOUNCEMENT',    // Comunicado general del complejo
  COMPLEX_ALERT          = 'COMPLEX_ALERT',          // Alerta de emergencia / corte de servicios
  AMENITY_REMINDER       = 'AMENITY_REMINDER',       // Recordatorio de reserva de zona común
}

registerEnumType(NotificationType, {
  name: 'NotificationType',
  description: 'Tipo de evento que originó la notificación',
});
