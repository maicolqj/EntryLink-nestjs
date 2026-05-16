import { registerEnumType } from '@nestjs/graphql';

export enum AuditAction {
  CREATE   = 'CREATE',
  UPDATE   = 'UPDATE',
  DELETE   = 'DELETE',
  RESTORE  = 'RESTORE',
  SUSPEND  = 'SUSPEND',
  ACTIVATE = 'ACTIVATE',
  APPROVE  = 'APPROVE',
  REJECT   = 'REJECT',
  LOGIN    = 'LOGIN',
  LOGOUT   = 'LOGOUT',
  REVERT         = 'REVERT',
  CALL_INCOMING  = 'CALL_INCOMING',
  CALL_OUTGOING  = 'CALL_OUTGOING',
  CALL_MISSED    = 'CALL_MISSED',
  CALL_REJECTED  = 'CALL_REJECTED',
}

registerEnumType(AuditAction, {
  name: 'AuditAction',
  description: 'Tipo de acción registrada en el historial de auditoría',
  valuesMap: {
    CREATE:        { description: 'Creación de un registro' },
    UPDATE:        { description: 'Modificación de un registro existente' },
    DELETE:        { description: 'Eliminación (soft o hard delete)' },
    RESTORE:       { description: 'Restauración de un registro eliminado' },
    SUSPEND:       { description: 'Suspensión de una entidad' },
    ACTIVATE:      { description: 'Activación o reactivación de una entidad' },
    APPROVE:       { description: 'Aprobación de una solicitud o entidad' },
    REJECT:        { description: 'Rechazo de una solicitud o entidad' },
    LOGIN:         { description: 'Inicio de sesión' },
    LOGOUT:        { description: 'Cierre de sesión' },
    REVERT:        { description: 'Reversión a estado anterior' },
    CALL_INCOMING: { description: 'Llamada entrante contestada' },
    CALL_OUTGOING: { description: 'Llamada saliente contestada' },
    CALL_MISSED:   { description: 'Llamada entrante no contestada' },
    CALL_REJECTED: { description: 'Llamada rechazada' },
  },
});
