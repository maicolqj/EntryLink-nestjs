import { registerEnumType } from '@nestjs/graphql';

/**
 * Naturaleza del radicado. Es lo que decide el turno y el tono de la respuesta,
 * y por eso lo elige el residente y no la administración.
 */
export enum PqrfType {
  PETICION = 'PETICION',
  QUEJA = 'QUEJA',
  RECLAMO = 'RECLAMO',
  SUGERENCIA = 'SUGERENCIA',
  FELICITACION = 'FELICITACION',
}

registerEnumType(PqrfType, {
  name: 'PqrfType',
  description:
    'Tipo de radicado: petición, queja, reclamo, sugerencia o felicitación',
});
