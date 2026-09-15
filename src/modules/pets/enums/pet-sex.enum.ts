import { registerEnumType } from '@nestjs/graphql';

export enum PetSex {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  UNKNOWN = 'UNKNOWN',
}

registerEnumType(PetSex, {
  name: 'PetSex',
  description: 'Sexo de la mascota',
  valuesMap: {
    MALE: { description: 'Macho' },
    FEMALE: { description: 'Hembra' },
    UNKNOWN: { description: 'Sin determinar' },
  },
});
