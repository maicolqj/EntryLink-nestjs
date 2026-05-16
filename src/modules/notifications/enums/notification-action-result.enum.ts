import { registerEnumType } from '@nestjs/graphql';

export enum NotificationActionResult {
  APPROVED     = 'APPROVED',
  REJECTED     = 'REJECTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
}

registerEnumType(NotificationActionResult, {
  name: 'NotificationActionResult',
  description: 'Resultado de la acción tomada sobre la notificación',
  valuesMap: {
    APPROVED:     { description: 'Acción aprobada' },
    REJECTED:     { description: 'Acción rechazada' },
    ACKNOWLEDGED: { description: 'Alerta reconocida' },
  },
});
