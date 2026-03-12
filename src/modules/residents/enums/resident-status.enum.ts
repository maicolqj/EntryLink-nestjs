import { registerEnumType } from '@nestjs/graphql';

export enum ResidentStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Esperando aprobación del Compliance Officer
  ACTIVE           = 'ACTIVE',           // Residente activo y verificado
  SUSPENDED        = 'SUSPENDED',        // Suspendido temporalmente (morosidad, sanción, etc.)
  MOVED_OUT        = 'MOVED_OUT',        // Se mudó, ya no vive en la unidad
  REJECTED         = 'REJECTED',         // Documentación rechazada por Compliance Officer
}

registerEnumType(ResidentStatus, {
  name: 'ResidentStatus',
  description: 'Estado del residente dentro del complejo',
  valuesMap: {
    PENDING_APPROVAL: { description: 'Esperando aprobación del Compliance Officer' },
    ACTIVE:           { description: 'Residente activo y verificado' },
    SUSPENDED:        { description: 'Suspendido temporalmente' },
    MOVED_OUT:        { description: 'Se mudó de la unidad' },
    REJECTED:         { description: 'Solicitud rechazada por documentación inválida' },
  },
});
