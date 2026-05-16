import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../../../modules/auth/services/token.service';
import { SessionService } from '../../../modules/auth/services/session.service';
import { UnitService } from '../../../modules/residential-complex/services/unit.service';
import { SocketService } from './socket.service';
import { WsExceptionFilter } from './ws-exception.filter';

@UseFilters(WsExceptionFilter)
@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class SocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly socketService: SocketService,
    private readonly unitService: UnitService,
  ) {}

  afterInit(server: Server): void {
    this.socketService.setServer(server);
    this.logger.log('Socket.io Gateway initialized with Redis Adapter');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const raw: string =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization ??
        '';
      const token = raw.replace(/^Bearer\s+/i, '').trim();

      if (!token) throw new Error('Token ausente');

      const payload = await this.tokenService.verifyAccessToken(token);
      const isActive = await this.sessionService.isSessionActive(payload.sessionId);
      if (!isActive) throw new Error('Sesión inactiva');

      client.data.user = payload;

      const rooms: string[] = [
        `complex:${payload.complexId}`,
        `user:${payload.sub}`,
      ];
      for (const role of payload.roles ?? []) {
        rooms.push(`role:${role}:complex:${payload.complexId}`);
      }
      await client.join(rooms);

      this.logger.log(
        `Conectado: ${client.id} | user:${payload.sub} | complex:${payload.complexId} | rooms:[${rooms.join(',')}]`,
      );
    } catch (err: any) {
      this.logger.warn(`Conexión rechazada: ${client.id} | ${err.message}`);
      client.emit('exception', { message: 'No autorizado' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('ping')
  handlePing(): { event: string; data: { timestamp: string } } {
    return { event: 'pong', data: { timestamp: new Date().toISOString() } };
  }

  @SubscribeMessage('join:unit')
  async handleJoinUnit(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { unitId: string },
  ): Promise<void> {
    const unitId = payload?.unitId;
    const user = client.data?.user;
    if (!unitId || !user) return;

    const unitComplexId = await this.unitService.findComplexIdByUnitInternal(unitId);
    if (unitComplexId !== user.complexId) return;

    await client.join(`unit:${unitId}`);
    this.logger.debug(`client ${client.id} joined unit:${unitId}`);
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.user?.sub ?? 'unknown';
    this.logger.log(`Desconectado: ${client.id} | user:${userId}`);
  }
}
