import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayload } from '../interfaces/jwt-payload.interface';

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
      throw new UnauthorizedException('Tipo de token inválido');
    }

    if (!payload.sub || !payload.sessionId || !payload.tokenFamily) {
      throw new UnauthorizedException('Token de refresco malformado');
    }

    // Adjuntamos el token raw para que el servicio pueda rotarlo
    (payload as any).rawToken = (req as any).headers?.authorization?.replace('Bearer ', '');

    return payload;
  }
}
