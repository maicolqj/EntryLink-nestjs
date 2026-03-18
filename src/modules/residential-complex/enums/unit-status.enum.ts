import { registerEnumType } from '@nestjs/graphql';

export enum UnitStatus {
  AVAILABLE   = 'AVAILABLE',   // Libre, sin residente
  OCCUPIED    = 'OCCUPIED',    // Con residente activo
  MAINTENANCE = 'MAINTENANCE', // En mantenimiento
  DISABLED    = 'DISABLED',    // Fuera de servicio
}

registerEnumType(UnitStatus, {
  name: 'UnitStatus',
  description: 'Estado de disponibilidad de la unidad',
});
