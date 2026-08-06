import { registerEnumType } from '@nestjs/graphql';

/**
 * Ciclo de vida de una alerta de pánico.
 *
 * PENDING → DELIVERED → ACKNOWLEDGED → RESOLVED
 *                                    ↘ FALSE_ALARM
 *
 * DELIVERED lo marca el propio dispositivo al mostrar la alerta (confirmación
 * automática); ACKNOWLEDGED es un acto humano: alguien tocó "atender".
 * La distinción es la que permite escalar: si nadie entregó, el problema es de
 * entrega; si nadie reconoció, el problema es de respuesta.
 */
export enum PanicAlertStatus {
  PENDING      = 'PENDING',
  DELIVERED    = 'DELIVERED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED     = 'RESOLVED',
  FALSE_ALARM  = 'FALSE_ALARM',
}

registerEnumType(PanicAlertStatus, {
  name: 'PanicAlertStatus',
  description: 'Estado de una alerta de pánico',
});
