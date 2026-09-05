import { registerEnumType } from '@nestjs/graphql';

/**
 * A quién va dirigido el radicado.
 *
 * No es un detalle de forma: define QUIÉN lo puede leer. Una queja dirigida solo
 * al consejo —típicamente sobre la propia administración— no puede aparecerle a
 * la administración, así que este campo es la frontera de visibilidad del
 * módulo.
 */
export enum PqrfAddressee {
  ADMINISTRACION = 'ADMINISTRACION',
  CONSEJO        = 'CONSEJO',
  AMBOS          = 'AMBOS',
}

registerEnumType(PqrfAddressee, {
  name: 'PqrfAddressee',
  description: 'Instancia a la que se dirige el radicado',
});

/** ¿Le corresponde a la administración? */
export const isForAdministration = (addressee: PqrfAddressee): boolean =>
  addressee === PqrfAddressee.ADMINISTRACION || addressee === PqrfAddressee.AMBOS;

/** ¿Le corresponde al consejo? */
export const isForCouncil = (addressee: PqrfAddressee): boolean =>
  addressee === PqrfAddressee.CONSEJO || addressee === PqrfAddressee.AMBOS;
