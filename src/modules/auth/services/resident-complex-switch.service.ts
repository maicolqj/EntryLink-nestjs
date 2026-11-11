import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { User } from '../../users/entities/user.entity';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode } from '../../shared/constans/error-codes.constants';
import {
  DeviceInfo,
  JwtAccessPayload,
} from '../interfaces/jwt-payload.interface';
import { AuthResponse } from '../dto/responses/auth-response';

/**
 * Selector de conjunto de RemoteLink: quien vive en varios conjuntos pasa de
 * uno a otro sin cerrar sesión.
 *
 * El conjunto viaja en el token, así que cambiarlo es rotar el refresh de la
 * sesión actual con otro `complexId` (ver `TokenService.rotateRefreshToken`):
 * todo lo que hoy filtra por el conjunto del token sigue igual.
 */
@Injectable()
export class ResidentComplexSwitchService {
  private readonly logger = new Logger(ResidentComplexSwitchService.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
  ) {}

  async switchComplex(
    currentUser: JwtAccessPayload,
    refreshToken: string,
    complexId: string,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const pair = await this.tokenService.rotateRefreshToken(
      refreshToken,
      deviceInfo,
      { complexIdOverride: complexId, requesterUserId: currentUser.sub },
    );

    // Mismo criterio que refreshToken: con la sesión cerrada el access token
    // nuevo saldría rechazado y la app quedaría sin datos.
    if (!(await this.sessionService.isSessionActive(pair.sessionId))) {
      await this.tokenService.revokeSession(
        pair.sessionId,
        'session_terminated',
      );
      throw new CustomError({
        message: 'Sesión terminada',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_TERMINATED,
      });
    }

    await this.sessionService
      .updateSessionActivity(pair.sessionId, deviceInfo.ip)
      .catch(() => undefined);

    await this.userRepo.update(currentUser.sub, {
      lastResidentComplexId: complexId,
    });

    await this.auditService.log({
      entityType: AuditEntityType.User,
      entityId: currentUser.sub,
      action: AuditAction.COMPLEX_SWITCH,
      previousValue: { complexId: currentUser.complexId ?? null },
      newValue: { complexId },
      performedById: currentUser.sub,
      performedByRole: 'RESIDENT_ROL',
      complexId,
      description: 'Cambio de conjunto desde RemoteLink',
      alwaysAudit: true,
    });

    this.logger.log(
      `Cambio de conjunto — sub: ${currentUser.sub} | ${currentUser.complexId ?? '-'} → ${complexId}`,
    );

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresIn: pair.expiresIn,
      sessionId: pair.sessionId,
    };
  }
}
