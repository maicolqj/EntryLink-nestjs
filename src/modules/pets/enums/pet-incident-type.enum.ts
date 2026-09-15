import { registerEnumType } from '@nestjs/graphql';

/**
 * Motivos por los que se reporta una mascota. La lista es cerrada a propósito:
 * las estadísticas por tipo son lo que le permite a la administración decidir
 * dónde poner una estación de bolsas en vez de seguir multando.
 */
export enum PetIncidentType {
  WASTE_NOT_PICKED_UP = 'WASTE_NOT_PICKED_UP', // Deposiciones no recogidas
  UNAUTHORIZED_AREA = 'UNAUTHORIZED_AREA', // Uso de zonas no autorizadas
  NO_LEASH_OR_MUZZLE = 'NO_LEASH_OR_MUZZLE', // Sin correa o sin bozal (raza especial)
  NOISE = 'NOISE', // Ladridos o ruido persistente
  AGGRESSION = 'AGGRESSION', // Agresión o mordedura a persona u otra mascota
  UNATTENDED = 'UNATTENDED', // Mascota suelta o sin acompañante
  ANIMAL_ABUSE = 'ANIMAL_ABUSE', // Maltrato o abandono del animal
  OTHER = 'OTHER',
}

registerEnumType(PetIncidentType, {
  name: 'PetIncidentType',
  description: 'Motivo del reporte de convivencia',
  valuesMap: {
    WASTE_NOT_PICKED_UP: { description: 'Deposiciones no recogidas' },
    UNAUTHORIZED_AREA: { description: 'Uso de zonas no autorizadas' },
    NO_LEASH_OR_MUZZLE: { description: 'Sin correa o sin bozal' },
    NOISE: { description: 'Ruido o ladridos persistentes' },
    AGGRESSION: { description: 'Agresión o mordedura' },
    UNATTENDED: { description: 'Mascota suelta o sin acompañante' },
    ANIMAL_ABUSE: { description: 'Maltrato o abandono del animal' },
    OTHER: { description: 'Otro motivo' },
  },
});
