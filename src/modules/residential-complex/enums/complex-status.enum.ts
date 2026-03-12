import { registerEnumType } from '@nestjs/graphql';

export enum ComplexStatus {
  PENDING_SETUP = 'PENDING_SETUP', // Recién creado, sin configurar
  ACTIVE        = 'ACTIVE',        // Operativo
  INACTIVE      = 'INACTIVE',      // Temporalmente inactivo
  SUSPENDED     = 'SUSPENDED',     // Suspendido por deuda o violación
}

registerEnumType(ComplexStatus, {
  name: 'ComplexStatus',
  description: 'Estado operativo del complejo residencial',
});
