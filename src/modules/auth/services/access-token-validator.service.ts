import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAccessPayload } from '../interfaces/jwt-payload.interface';
import { User } from '../../users/entities/user.entity';
import { isUserStatusOperable } from '../utils/user-status.util';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  AuthErrorCode,
  ComplexErrorCode,
  UserErrorCode,
} from '../../shared/constans/error-codes.constants';

/**
 * Validación de un access token ya verificado (firma y vigencia), común a
 * HTTP (GraphQL y REST, vía `JwtAccessStrategy`) y a Socket.IO.
 *
 * Costo por petición: una lectura de Redis (versión del token) y otra de la
 * sesión. La base solo se consulta cuando la versión no está en caché (5 min).
 *
 * Por qué alcanza con la caché: toda operación que corta el acceso de una
 * cuenta (suspender, cambiar el rol, la clave, los permisos) sube
 * `tokenVersion` y borra la versión cacheada. La petición siguiente con el
 * token viejo choca con la versión, o vuelve a la base y ve el estado.
 */
@Injectable()
export class AccessTokenValidatorService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
  ) {}

  async validate(payload: JwtAccessPayload): Promise<JwtAccessPayload> {
    if (payload.type !== 'access') {
      throw new CustomError({
        message: 'Tipo de token inválido',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.INVALID_TOKEN_TYPE,
      });
    }

    let version = await this.tokenService.getUserTokenVersion(payload.sub);

    if (version === null) {
      version =
        payload.entityType === 'complex'
          ? await this.loadComplexVersion(payload.sub)
          : await this.loadUserVersion(payload.sub);
      await this.tokenService.setUserTokenVersion(payload.sub, version);
    }

    if (version !== payload.tokenVersion) {
      throw new CustomError({
        message: 'Sesión expirada. Inicia sesión nuevamente',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_EXPIRED,
      });
    }

    const isActive = await this.sessionService.isSessionActive(
      payload.sessionId,
    );
    if (!isActive) {
      throw new CustomError({
        message: 'Sesión terminada',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_TERMINATED,
      });
    }

    return payload;
  }

  private async loadComplexVersion(complexId: string): Promise<number> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
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

    // SUSPENDED no se corta aquí: la sesión sigue viva para mostrar la
    // pantalla de suspensión, y el SubscriptionGuard bloquea lo demás.
    return complex.tokenVersion ?? 0;
  }

  private async loadUserVersion(userId: string): Promise<number> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'tokenVersion', 'status', 'deletedAt'],
    });

    if (!user || user.deletedAt) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (!isUserStatusOperable(user.status)) {
      // SESSION_TERMINATED: las apps y la web ya lo tratan como «volver al
      // login». El motivo concreto lo da el login (USER_SUSPENDED).
      throw new CustomError({
        message: 'Tu cuenta no está activa. Contacta al administrador',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_TERMINATED,
      });
    }

    return user.tokenVersion ?? 0;
  }
}
