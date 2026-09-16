import { registerEnumType } from '@nestjs/graphql';

export enum PetSpecies {
  DOG = 'DOG',
  CAT = 'CAT',
  OTHER = 'OTHER',
}

registerEnumType(PetSpecies, {
  name: 'PetSpecies',
  description: 'Especie de la mascota',
  valuesMap: {
    DOG: { description: 'Perro' },
    CAT: { description: 'Gato' },
    OTHER: { description: 'Otra especie (ave, roedor, reptil…)' },
  },
});
