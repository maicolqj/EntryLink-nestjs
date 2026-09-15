import { registerEnumType } from '@nestjs/graphql';

/**
 * Columnas del tablero Kanban.
 *
 * `RESOLVED` y `CLOSED` son distintos a propósito: resuelto lo declara quien
 * reparó, cerrado lo confirma quien reportó (o el autocierre). Fundirlos
 * dejaría la calificación sin momento en el que caber y le quitaría al
 * residente la única oportunidad de decir que el trabajo quedó mal.
 */
export enum MaintenanceTicketStatus {
  /** Radicado, nadie lo ha mirado. */
  NEW = 'NEW',
  /** Revisado: ya tiene categoría, prioridad y SLA definitivos. */
  TRIAGED = 'TRIAGED',
  /** Con responsable —interno o proveedor— y fecha estimada. */
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  /** Detenido por causa externa: repuesto, presupuesto, consejo. */
  ON_HOLD = 'ON_HOLD',
  /** Reparado con evidencia. Falta la confirmación de quien reportó. */
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
  /** No procede: no es zona común, no hay daño, reporte malicioso. */
  REJECTED = 'REJECTED',
  /** Es el mismo daño de otro ticket abierto. */
  DUPLICATE = 'DUPLICATE',
}

registerEnumType(MaintenanceTicketStatus, {
  name: 'MaintenanceTicketStatus',
  description: 'Estado del ticket en el tablero de mantenimiento',
});
