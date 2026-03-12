import { registerEnumType } from '@nestjs/graphql';

export enum NotificationPriority {
  LOW    = 'LOW',
  NORMAL = 'NORMAL',
  HIGH   = 'HIGH',
  URGENT = 'URGENT',  // Alerta de emergencia — sonido + vibración incluso en silencio
}

registerEnumType(NotificationPriority, {
  name: 'NotificationPriority',
  description: 'Prioridad de entrega de la notificación',
});
