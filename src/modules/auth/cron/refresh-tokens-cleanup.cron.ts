import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TokenService } from '../services/token.service';

/**
 * Limpieza diaria de `refresh_tokens`.
 *
 * Cada rotación deja la fila anterior revocada: un solo equipo activo suma
 * decenas al día. Sin este barrido la tabla solo crece, y con ella el índice
 * único de `tokenHash` que se consulta en cada renovación.
 */
@Injectable()
export class RefreshTokensCleanupCron {
  private readonly logger = new Logger(RefreshTokensCleanupCron.name);

  constructor(private readonly tokenService: TokenService) {}

  /** A las 3 a. m., cuando casi nadie está renovando sesión. */
  @Cron('0 3 * * *', { timeZone: 'America/Bogota' })
  async sweep(): Promise<void> {
    try {
      const deleted = await this.tokenService.cleanupExpiredTokens();
      if (deleted > 0) {
        this.logger.log(`Refresh tokens borrados: ${deleted}`);
      }
    } catch (err: any) {
      this.logger.error(
        `Error al limpiar refresh tokens: ${err?.message}`,
        err?.stack,
      );
    }
  }
}
