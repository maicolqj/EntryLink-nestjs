import { registerEnumType } from '@nestjs/graphql';

export enum ResidentType {
  OWNER         = 'OWNER',         // Propietario del inmueble
  TENANT        = 'TENANT',        // Arrendatario / inquilino
  FAMILY_MEMBER = 'FAMILY_MEMBER', // Familiar del propietario o inquilino
  CARETAKER     = 'CARETAKER',     // Cuidador / empleado doméstico permanente
}

registerEnumType(ResidentType, {
  name: 'ResidentType',
  description: 'Tipo de residente respecto a la unidad',
  valuesMap: {
    OWNER:         { description: 'Propietario del inmueble' },
    TENANT:        { description: 'Arrendatario o inquilino' },
    FAMILY_MEMBER: { description: 'Familiar del propietario o inquilino' },
    CARETAKER:     { description: 'Cuidador o empleado doméstico permanente' },
  },
});
