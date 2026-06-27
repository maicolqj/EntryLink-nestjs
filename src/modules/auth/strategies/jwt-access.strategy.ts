import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAccessPayload } from '../interfaces/jwt-payload.interface';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { TokenService } from '../services/token.service';
import { SessionService } from '../services/session.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode, ComplexErrorCode, UserErrorCode } from '../../shared/constans/error-codes.constants';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtAccessStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ResidentialComplex) private readonly complexRepo: Repository<ResidentialComplex>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: configService.get<string>('JWT_ISSUER'),
    });
  }

  async validate(payload: JwtAccessPayload): Promise<JwtAccessPayload> {
    if (payload.type !== 'access') {
      throw new CustomError({
        message: 'Tipo de token inválido',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.INVALID_TOKEN_TYPE,
      });
    }

    // Verificar tokenVersion (primero en cache, luego en BD)
    let version = await this.tokenService.getUserTokenVersion(payload.sub);

    if (version === null) {
      if (payload.entityType === 'complex') {
        const complex = await this.complexRepo.findOne({
          where: { id: payload.sub },
          select: ['id', 'tokenVersion', 'status', 'deletedAt'],
        });

        if (!complex || complex.deletedAt) {
          throw new CustomError({
            message: 'Complejo no encontrado',
            statusCode: HttpStatus.UNAUTHORIZED,
            errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
          });
        }

        if (complex.status === ComplexStatus.INACTIVE) {
          throw new CustomError({
            message: 'El complejo residencial está inactivo',
            statusCode: HttpStatus.UNAUTHORIZED,
            errorCode: AuthErrorCode.COMPLEX_INACTIVE,
          });
        }

        if (complex.status === ComplexStatus.SUSPENDED) {
          throw new CustomError({
            message: 'El complejo residencial está suspendido',
            statusCode: HttpStatus.UNAUTHORIZED,
            errorCode: AuthErrorCode.COMPLEX_SUSPENDED,
          });
        }

        version = complex.tokenVersion ?? 0;
      } else {
        const user = await this.userRepo.findOne({
          where: { id: payload.sub },
          select: ['id', 'tokenVersion', 'status', 'deletedAt'],
        });

        if (!user || user.deletedAt) {
          throw new CustomError({
            message: 'Usuario no encontrado',
            statusCode: HttpStatus.UNAUTHORIZED,
            errorCode: UserErrorCode.USER_NOT_FOUND,
          });
        }

        version = user.tokenVersion ?? 0;
      }

      await this.tokenService.setUserTokenVersion(payload.sub, version);
    }

    if (version !== payload.tokenVersion) {
      throw new CustomError({
        message: 'Sesión expirada. Inicia sesión nuevamente',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_EXPIRED,
      });
    }

    // Verificar que la sesión siga activa
    const isActive = await this.sessionService.isSessionActive(payload.sessionId);
    if (!isActive) {
      throw new CustomError({
        message: 'Sesión terminada',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_TERMINATED,
      });
    }

    return payload;
  }
}
