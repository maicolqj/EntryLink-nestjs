import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Obliga a una cuenta a volver a iniciar sesión: sube `tokenVersion` (ningún
 * access token anterior pasa), cierra sus sesiones, revoca sus refresh tokens
 * y desconecta sus sockets en todas las instancias.
 *
 * La cuenta sigue activa: lo que cambia es lo que obtiene en el próximo inicio
 * de sesión. Lo usa la suspensión de una ficha de residente, que no suspende
 * la cuenta pero sí le quita el acceso a ese conjunto.
 */
@Injectable()
export class AccountAccessService {
  private readonly logger = new Logger(AccountAccessService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly socketService: SocketService,
  ) {}

  /**
   * No lanza: si una parte falla queda registrado y `complete` sale en false.
   * Subir la versión va primero porque, solo con eso, ningún token viejo pasa.
   */
  async forceRelogin(
    userId: string,
    reason: string,
  ): Promise<{ closed: number; complete: boolean }> {
    let closed = 0;
    let complete = true;
    const step = async (name: string, fn: () => unknown) => {
      try {
        await fn();
      } catch (err) {
        complete = false;
        this.logger.error(
          `${name} falló para ${userId} (${reason}): ${(err as Error).message}`,
        );
      }
    };

    await step('Subir tokenVersion', () =>
      this.userRepo.update(userId, {
        tokenVersion: () => '"tokenVersion" + 1',
      }),
    );
    await step('Cerrar sesiones', async () => {
      closed = await this.sessionService.terminateAllUserSessions(userId);
    });
    await step('Revocar refresh tokens', () =>
      this.tokenService.invalidateUserSessions(userId, reason),
    );
    await step('Desconectar sockets', () =>
      this.socketService.disconnectUser(userId),
    );

    return { closed, complete };
  }
}
