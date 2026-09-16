import { registerEnumType } from '@nestjs/graphql';

/**
 * Quién puede ver el ticket además de la administración y de quien lo radicó.
 *
 * `PUBLIC` es el valor por defecto y es lo que evita los treinta reportes del
 * mismo ascensor: si el vecino ve que ya está reportado y en qué va, no vuelve
 * a radicarlo. `PRIVATE` queda para lo que no debe andar suelto —una falla de
 * la cámara del acceso, por ejemplo, es un mapa para quien quiera entrar—.
 */
export enum MaintenanceVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

registerEnumType(MaintenanceVisibility, {
  name: 'MaintenanceVisibility',
  description: 'Alcance de lectura del ticket dentro del complejo',
});
