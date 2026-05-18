import { registerEnumType } from '@nestjs/graphql';

export enum ComplexStatus {
  PENDING_REVIEW = 'PENDING_REVIEW', // Solicitud enviada, pendiente de aprobación
  PENDING_SETUP  = 'PENDING_SETUP',  // Aprobado, sin configurar
  ACTIVE         = 'ACTIVE',         // Operativo
  INACTIVE       = 'INACTIVE',       // Temporalmente inactivo
  SUSPENDED      = 'SUSPENDED',      // Suspendido por deuda o violación
}

registerEnumType(ComplexStatus, {
  name: 'ComplexStatus',
  description: 'Estado operativo del complejo residencial',
});
