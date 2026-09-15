import { registerEnumType } from '@nestjs/graphql';

export enum MaintenanceAssigneeType {
  /** Personal del conjunto: todero, jardinero, aseo. Es un usuario del sistema. */
  INTERNAL = 'INTERNAL',
  /** Proveedor externo. No entra a la plataforma; lo representa un registro. */
  VENDOR = 'VENDOR',
}

registerEnumType(MaintenanceAssigneeType, {
  name: 'MaintenanceAssigneeType',
  description: 'Naturaleza del responsable asignado al ticket',
});
