import { registerEnumType } from '@nestjs/graphql';

export enum PetStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Ficha registrada, esperando validación
  ACTIVE = 'ACTIVE', // Mascota censada y autorizada
  REJECTED = 'REJECTED', // Ficha rechazada (datos o póliza inválidos)
  SUSPENDED = 'SUSPENDED', // Autorización suspendida por incumplimiento
  REMOVED = 'REMOVED', // Ya no vive en el complejo (mudanza, entrega)
  DECEASED = 'DECEASED', // Falleció: se conserva el historial, no el censo
}

registerEnumType(PetStatus, {
  name: 'PetStatus',
  description: 'Estado de la mascota dentro del complejo',
  valuesMap: {
    PENDING_APPROVAL: { description: 'Esperando validación de la ficha' },
    ACTIVE: { description: 'Censada y autorizada' },
    REJECTED: { description: 'Ficha rechazada' },
    SUSPENDED: { description: 'Autorización suspendida' },
    REMOVED: { description: 'Retirada del complejo' },
    DECEASED: { description: 'Fallecida' },
  },
});
