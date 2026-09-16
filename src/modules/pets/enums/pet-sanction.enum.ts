import { registerEnumType } from '@nestjs/graphql';

/**
 * Con qué termina un caso validado. Desestimarlo no está aquí: eso no es una
 * sanción, es cerrar el expediente sin consecuencias para la unidad.
 */
export enum PetSanction {
  WARNING = 'WARNING', // Llamado de atención, sin efecto en la cartera
  FINE = 'FINE', // Multa cargada a la cuenta de la unidad
}

registerEnumType(PetSanction, {
  name: 'PetSanction',
  description: 'Sanción con la que se cierra un reporte validado',
  valuesMap: {
    WARNING: { description: 'Llamado de atención' },
    FINE: { description: 'Multa cargada a la unidad' },
  },
});
