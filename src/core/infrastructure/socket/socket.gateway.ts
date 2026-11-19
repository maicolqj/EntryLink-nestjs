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
import { AccessTokenValidatorService } from '../../../modules/auth/services/access-token-validator.service';
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
export class SocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly accessTokenValidator: AccessTokenValidatorService,
    private readonly socketService: SocketService,
    private readonly unitService: UnitService,
  ) {}

  afterInit(server: Server): void {
    this.socketService.setServer(server);

    // Auth + room-joining runs in connection middleware so next() is only called
    // after the client has already joined all rooms. This eliminates the race
    // window that existed when handleConnection was async: emits fired during
    // token-verify / session-check would arrive before client.join() completed.
    server.use(async (client, next) => {
      try {
        const raw: string =
          client.handshake.auth?.token ??
          client.handshake.headers?.authorization ??
          '';
        const token = raw.replace(/^Bearer\s+/i, '').trim();

        if (!token) return next(new Error('No autorizado'));

        // Firma, vigencia y lista negra; después, la misma validación que HTTP:
        // versión del token, cuenta activa y sesión viva. Antes solo se miraba
        // la sesión, así que un token anterior a una suspensión o a un cambio
        // de rol seguía abriendo el socket hasta vencer (15 min).
        const payload = await this.accessTokenValidator.validate(
          await this.tokenService.verifyAccessToken(token),
        );

        client.data.user = payload;

        const rooms: string[] = [
          `complex:${payload.complexId}`,
          `user:${payload.sub}`,
        ];
        for (const role of payload.roles ?? []) {
          rooms.push(`role:${role}:complex:${payload.complexId}`);
        }
        await client.join(rooms);

        next();
      } catch (err: any) {
        this.logger.warn(`Conexión rechazada: ${client.id} | ${err.message}`);
        next(new Error('No autorizado'));
      }
    });

    this.logger.log('Socket.io Gateway initialized with Redis Adapter');
  }

  handleConnection(client: Socket): void {
    const payload = client.data.user;
    this.logger.log(
      `Conectado: ${client.id} | user:${payload?.sub} | complex:${payload?.complexId}`,
    );
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

    const unitComplexId =
      await this.unitService.findComplexIdByUnitInternal(unitId);
    if (unitComplexId !== user.complexId) return;

    await client.join(`unit:${unitId}`);
    this.logger.debug(`client ${client.id} joined unit:${unitId}`);
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.user?.sub ?? 'unknown';
    this.logger.log(`Desconectado: ${client.id} | user:${userId}`);
  }
}
