import { Injectable } from '@nestjs/common';

import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Eventos Socket.io del módulo IoT hacia RemoteLink (contrato en README_IOT.md).
 *
 * Van aparte del enum global `SocketEvent` para no modificarlo: este emisor
 * reutiliza las salas del gateway existente (`user:<id>`, `role:<rol>:complex:<id>`).
 */
export enum IotSocketEvent {
  /** Telemetría nueva de un aparato del usuario. */
  TELEMETRY = 'device:telemetry',
  /** Alerta de la matera (sed, tanque vacío, sin conexión…). */
  ALERT = 'device:alert',
  /** El usuario vinculó un aparato. */
  LINKED = 'device:linked',
  /** Reset de fábrica: el aparato dejó de ser del usuario. */
  FACTORY_RESET = 'device:factory_reset',
  /** Respuesta del aparato a un comando (set_plant, ota, identify…). */
  ACK = 'device:ack',
  /** Cambió `connected` (enchufado al broker o no). */
  PRESENCE = 'device:presence',
}

@Injectable()
export class IotSocketEmitter {
  constructor(private readonly sockets: SocketService) {}

  toUser(userId: string, event: IotSocketEvent, data: unknown): void {
    // El enum global no conoce estos eventos; la cadena viaja igual por Socket.io
    this.sockets.emitToUser(userId, event as unknown as SocketEvent, data);
  }

  toComplexAdmins(
    complexId: string,
    event: IotSocketEvent,
    data: unknown,
  ): void {
    this.sockets.emitToRole(
      ValidRoles.COMPLEX_ROL,
      complexId,
      event as unknown as SocketEvent,
      data,
    );
  }
}
