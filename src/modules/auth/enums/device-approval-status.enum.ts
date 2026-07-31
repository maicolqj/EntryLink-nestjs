import { registerEnumType } from '@nestjs/graphql';

/** Ciclo de vida de una solicitud de ingreso aprobada desde otro dispositivo. */
export enum DeviceApprovalStatus {
  /** Emitida; esperando que el residente apruebe desde un dispositivo confiable. */
  PENDING = 'PENDING',
  /** Aprobada. El dispositivo solicitante ya puede canjearla. */
  APPROVED = 'APPROVED',
  /** El residente la rechazó: no era él quien intentaba entrar. */
  DENIED = 'DENIED',
  /** Ya se canjeó por una sesión. No se puede reutilizar. */
  CONSUMED = 'CONSUMED',
  /** Venció antes de resolverse. */
  EXPIRED = 'EXPIRED',
}

registerEnumType(DeviceApprovalStatus, {
  name: 'DeviceApprovalStatus',
  description: 'Estado de una solicitud de ingreso pendiente de aprobación por push',
});
