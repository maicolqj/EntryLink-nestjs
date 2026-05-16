import { registerEnumType } from '@nestjs/graphql';

/**
 * Describe el ESCENARIO de la acción requerida.
 * El frontend decide qué botones mostrar según este valor:
 *  - RESIDENT_APPROVAL  → [Aprobar] [Rechazar]
 *  - VEHICLE_APPROVAL   → [Aprobar] [Rechazar]
 *  - VISIT_APPROVAL     → [Autorizar] [Denegar]
 *  - ACCESS_REQUEST     → [Aprobar acceso] [Rechazar]
 *  - ACKNOWLEDGE        → [Reconocer]
 */
export enum NotificationActionType {
  RESIDENT_APPROVAL = 'RESIDENT_APPROVAL',  // Nueva solicitud de residencia
  VEHICLE_APPROVAL  = 'VEHICLE_APPROVAL',   // Nuevo vehículo pendiente
  VISIT_APPROVAL    = 'VISIT_APPROVAL',     // Visita walk-in esperando entrada
  ACCESS_REQUEST    = 'ACCESS_REQUEST',     // Solicitud de acceso de supervisor
  ACKNOWLEDGE       = 'ACKNOWLEDGE',        // Reconocer alerta (pánico, emergencia)
}

registerEnumType(NotificationActionType, {
  name: 'NotificationActionType',
  description: 'Escenario de acción requerida. El frontend usa este valor para determinar qué botones mostrar.',
  valuesMap: {
    RESIDENT_APPROVAL: { description: 'Nueva solicitud de residencia — [Aprobar] [Rechazar]' },
    VEHICLE_APPROVAL:  { description: 'Nuevo vehículo pendiente — [Aprobar] [Rechazar]' },
    VISIT_APPROVAL:    { description: 'Visita walk-in esperando entrada — [Autorizar] [Denegar]' },
    ACCESS_REQUEST:    { description: 'Solicitud de acceso de supervisor — [Aprobar acceso] [Rechazar]' },
    ACKNOWLEDGE:       { description: 'Alerta que requiere confirmación — [Reconocer]' },
  },
});
