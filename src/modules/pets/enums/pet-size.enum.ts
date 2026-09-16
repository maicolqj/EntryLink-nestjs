import { registerEnumType } from '@nestjs/graphql';

/**
 * Porte de la mascota. No es un dato decorativo: en la mayoría de reglamentos
 * el porte define por dónde puede transitar (ascensor, zonas comunes) y es lo
 * primero que describe quien reporta un incidente sin conocer al animal.
 */
export enum PetSize {
  SMALL = 'SMALL',
  MEDIUM = 'MEDIUM',
  LARGE = 'LARGE',
}

registerEnumType(PetSize, {
  name: 'PetSize',
  description: 'Porte de la mascota',
  valuesMap: {
    SMALL: { description: 'Pequeño (hasta ~10 kg)' },
    MEDIUM: { description: 'Mediano (~10 a 25 kg)' },
    LARGE: { description: 'Grande (más de ~25 kg)' },
  },
});
