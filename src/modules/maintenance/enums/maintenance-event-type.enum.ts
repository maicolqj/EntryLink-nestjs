import { registerEnumType } from '@nestjs/graphql';

/** Qué clase de anotación es cada renglón de la bitácora del ticket. */
export enum MaintenanceEventType {
  CREATED = 'CREATED',
  TRIAGED = 'TRIAGED',
  ASSIGNED = 'ASSIGNED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  /** Avance con fotos que sube quien está reparando. */
  PROGRESS = 'PROGRESS',
  COMMENT = 'COMMENT',
  RESOLVED = 'RESOLVED',
  REOPENED = 'REOPENED',
  CLOSED = 'CLOSED',
  RATED = 'RATED',
  ENDORSED = 'ENDORSED',
  SLA_BREACHED = 'SLA_BREACHED',
}

registerEnumType(MaintenanceEventType, {
  name: 'MaintenanceEventType',
  description: 'Tipo de anotación en la bitácora del ticket',
});
