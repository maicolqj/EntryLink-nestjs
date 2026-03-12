import { registerEnumType } from '@nestjs/graphql';

export enum VehicleStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Registrado, esperando aprobación del admin
  ACTIVE           = 'ACTIVE',           // Vehículo autorizado en el complejo
  SUSPENDED        = 'SUSPENDED',        // Acceso temporalmente suspendido
  REJECTED         = 'REJECTED',         // Solicitud rechazada (documentos inválidos, etc.)
  REMOVED          = 'REMOVED',          // Retirado del complejo permanentemente
}

registerEnumType(VehicleStatus, {
  name: 'VehicleStatus',
  description: 'Estado del vehículo dentro del complejo',
  valuesMap: {
    PENDING_APPROVAL: { description: 'Esperando aprobación del administrador' },
    ACTIVE:           { description: 'Autorizado para circular y parquear' },
    SUSPENDED:        { description: 'Acceso suspendido temporalmente' },
    REJECTED:         { description: 'Solicitud rechazada' },
    REMOVED:          { description: 'Removido definitivamente del complejo' },
  },
});
