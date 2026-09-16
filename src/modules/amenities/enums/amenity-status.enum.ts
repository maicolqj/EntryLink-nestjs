import { registerEnumType } from '@nestjs/graphql';

export enum AmenityStatus {
  /** Operativa: admite reservas nuevas */
  ACTIVE = 'ACTIVE',
  /** En mantenimiento: no admite reservas nuevas, las aprobadas siguen vigentes */
  MAINTENANCE = 'MAINTENANCE',
  /** Deshabilitada por el administrador */
  INACTIVE = 'INACTIVE',
}

registerEnumType(AmenityStatus, {
  name: 'AmenityStatus',
  description: 'Estado operativo de la zona común',
});
