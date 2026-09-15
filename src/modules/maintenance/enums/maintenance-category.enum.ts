import { registerEnumType } from '@nestjs/graphql';

/**
 * Oficio que se necesita para arreglar el daño.
 *
 * La categoría no es una etiqueta cosmética: de ella salen el SLA aplicable
 * (una filtración de gas no espera lo mismo que una lámpara fundida) y el
 * proveedor al que se le asigna. Por eso está pegada al oficio y no a la zona
 * del conjunto —la zona ya la dice la ubicación—.
 */
export enum MaintenanceCategory {
  ILUMINACION = 'ILUMINACION',
  ELECTRICO = 'ELECTRICO',
  PLOMERIA = 'PLOMERIA',
  ESTRUCTURA = 'ESTRUCTURA',
  ASCENSORES = 'ASCENSORES',
  PUERTAS_Y_ACCESOS = 'PUERTAS_Y_ACCESOS',
  SEGURIDAD = 'SEGURIDAD',
  ASEO = 'ASEO',
  JARDINERIA = 'JARDINERIA',
  PISCINA = 'PISCINA',
  GAS = 'GAS',
  OTRO = 'OTRO',
}

registerEnumType(MaintenanceCategory, {
  name: 'MaintenanceCategory',
  description: 'Tipo de daño reportado en zonas comunes',
});
