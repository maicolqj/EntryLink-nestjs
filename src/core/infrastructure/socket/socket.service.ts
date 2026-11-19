import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { SocketEvent } from './socket.events';

@Injectable()
export class SocketService {
  private readonly logger = new Logger(SocketService.name);
  private server: Server;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToComplex(complexId: string, event: SocketEvent, data: unknown): void {
    this.server?.to(`complex:${complexId}`).emit(event, data);
    this.logger.debug(`emit ${event} → complex:${complexId}`);
  }

  emitToUser(userId: string, event: SocketEvent, data: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, data);
    this.logger.debug(`emit ${event} → user:${userId}`);
  }

  emitToUsers(userIds: string[], event: SocketEvent, data: unknown): void {
    for (const userId of userIds) {
      this.emitToUser(userId, event, data);
    }
  }

  emitToRole(
    role: string,
    complexId: string,
    event: SocketEvent,
    data: unknown,
  ): void {
    this.server?.to(`role:${role}:complex:${complexId}`).emit(event, data);
    this.logger.debug(`emit ${event} → role:${role}:complex:${complexId}`);
  }

  emitToUnit(unitId: string, event: SocketEvent, data: unknown): void {
    this.server?.to(`unit:${unitId}`).emit(event, data);
    this.logger.debug(`emit ${event} → unit:${unitId}`);
  }

  /**
   * Cierra todos los sockets del usuario, en todas las instancias (el
   * adaptador de Redis reparte la orden). Al reconectar, el handshake vuelve a
   * validar el token y una cuenta suspendida ya no entra.
   */
  disconnectUser(userId: string): void {
    this.server?.in(`user:${userId}`).disconnectSockets(true);
    this.logger.debug(`disconnect → user:${userId}`);
  }
}
