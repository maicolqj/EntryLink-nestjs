import { registerEnumType } from '@nestjs/graphql';

export enum PackageStatus {
  RECEIVED         = 'RECEIVED',          // Registrado en portería, aún no notificado
  NOTIFIED         = 'NOTIFIED',          // Residente notificado, pendiente retiro
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',  // Listo para ser recogido (confirmado)
  DELIVERED        = 'DELIVERED',         // Entregado al residente
  RETURNED         = 'RETURNED',          // Devuelto al remitente
  LOST             = 'LOST',              // Registrado como perdido
}

registerEnumType(PackageStatus, {
  name: 'PackageStatus',
  description: 'Estado del paquete en el ciclo de vida de la paquetería',
});
