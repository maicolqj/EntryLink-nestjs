import { registerEnumType } from '@nestjs/graphql';

/**
 * Urgencia del ticket. Quien reporta puede sugerirla, pero la que manda es la
 * que fija la administración al revisar: si el residente decidiera la
 * prioridad, todo llegaría en CRITICAL y el tablero dejaría de ordenar nada.
 */
export enum MaintenancePriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  /** Riesgo para la vida o la propiedad: gas, ascensor con gente adentro, cable vivo. */
  CRITICAL = 'CRITICAL',
}

registerEnumType(MaintenancePriority, {
  name: 'MaintenancePriority',
  description: 'Prioridad de atención del ticket de mantenimiento',
});
