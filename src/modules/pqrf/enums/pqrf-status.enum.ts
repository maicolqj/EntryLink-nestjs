import { registerEnumType } from '@nestjs/graphql';

/**
 * Ciclo de vida del radicado.
 *
 *   RADICADO ──> EN_TRAMITE ──> RESUELTO
 *
 * EN_TRAMITE lo pone el sistema en cuanto el primer destinatario abre el
 * radicado: el residente merece saber que alguien ya lo leyó, y esperar a que
 * alguien pulse un botón para decírselo sería inventar un trámite.
 *
 * RESUELTO exige que TODOS los destinatarios lo hayan marcado. Si el radicado
 * fue a las dos instancias, una sola no puede darlo por cerrado en nombre de
 * la otra.
 */
export enum PqrfStatus {
  RADICADO = 'RADICADO',
  EN_TRAMITE = 'EN_TRAMITE',
  RESUELTO = 'RESUELTO',
}

registerEnumType(PqrfStatus, {
  name: 'PqrfStatus',
  description: 'Estado del radicado PQRF',
});
