import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAccessPayload } from '../interfaces/jwt-payload.interface';
import { User } from '../../users/entities/user.entity';
import { TokenService } from '../services/token.service';
import { SessionService } from '../services/session.service';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtAccessStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: configService.get<string>('JWT_ISSUER'),
    });
  }

  async validate(payload: JwtAccessPayload): Promise<JwtAccessPayload> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Tipo de token inválido');
    }

    // Verificar tokenVersion (primero en cache, luego en BD)
    let version = await this.tokenService.getUserTokenVersion(payload.sub);

    if (version === null) {
      const user = await this.userRepo.findOne({
        where: { id: payload.sub },
        select: ['id', 'tokenVersion', 'status', 'deletedAt'],
      });

      if (!user || user.deletedAt) {
        throw new UnauthorizedException('Usuario no encontrado');
      }

      version = user.tokenVersion ?? 0;
      await this.tokenService.setUserTokenVersion(payload.sub, version);
    }

    if (version !== payload.tokenVersion) {
      throw new UnauthorizedException('Sesión expirada. Inicia sesión nuevamente');
    }

    // Verificar que la sesión siga activa
    const isActive = await this.sessionService.isSessionActive(payload.sessionId);
    if (!isActive) {
      throw new UnauthorizedException('Sesión terminada');
    }

    return payload;
  }
}
