import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  catch(exception: WsException | Error, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const raw = exception instanceof WsException ? exception.getError() : exception.message;
    const message = typeof raw === 'string' ? raw : (raw as any)?.message ?? 'Internal server error';
    const code = exception instanceof WsException ? 'WS_EXCEPTION' : 'INTERNAL_ERROR';
    client.emit('exception', { message, code });
  }
}
