import { Injectable, HttpStatus } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayload } from '../interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode } from '../../shared/constans/error-codes.constants';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtRefreshPayload): Promise<JwtRefreshPayload> {
    if (payload.type !== 'refresh') {
      throw new CustomError({
        message: 'Tipo de token inválido',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.INVALID_TOKEN_TYPE,
      });
    }

    if (!payload.sub || !payload.sessionId || !payload.tokenFamily) {
      throw new CustomError({
        message: 'Token de refresco malformado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.REFRESH_TOKEN_MALFORMED,
      });
    }

    // Adjuntamos el token raw para que el servicio pueda rotarlo
    (payload as any).rawToken = (req as any).headers?.authorization?.replace('Bearer ', '');

    return payload;
  }
}
