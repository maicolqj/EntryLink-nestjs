// modules/auth/services/token.service.ts
import { Injectable, Logger, HttpStatus, Optional } from '@nestjs/common';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  AuthErrorCode,
  ComplexErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { UserPermissionOverride } from '../../users/entities/user-permission-override.entity';
import { PermissionOverrideEffect } from '../../users/enums/permission-override-effect.enum';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Role } from '../../roles/entities/role.entity';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS, RefreshExpiry } from '../constants/auth.constants';
import {
  JwtAccessPayload,
  JwtRefreshPayload,
  DeviceInfo,
  TokenPair,
} from '../interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { v4 as uuidv4 } from 'uuid';
import { isUserStatusOperable } from '../utils/user-status.util';
import { ResidentTenancyService } from './resident-tenancy.service';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(UserPermissionOverride)
    private readonly permissionOverrideRepo: Repository<UserPermissionOverride>,
    // Opcional para no obligar a las pruebas que arman TokenService a mano;
    // en la app siempre está (mismo módulo).
    @Optional()
    private readonly residentTenancy?: ResidentTenancyService,
  ) {}

  /**
   * @param refreshExpiryOverride vigencia explícita del refresh token (ej. '180d').
   *   Se persiste en la fila para que la rotación la conserve. Sin este parámetro
   *   la vigencia sale de `rememberMe`.
   * @param complexIdOverride complejo de la sesión cuando no es el de la cuenta.
   *   Lo usan los canales de residente: `users.complex_id` dice a qué conjunto
   *   pertenece la cuenta de trabajo, no dónde vive la persona, y para quien
   *   administra viene vacío. Viaja también en el refresh token para que la
   *   rotación lo conserve, igual que se hace con las sesiones de complejo.
   */
  async generateTokenPair(
    user: User,
    deviceInfo: DeviceInfo,
    rememberMe = false,
    entityType: 'user' | 'complex' = 'user',
    refreshExpiryOverride?: RefreshExpiry,
    roleScope?: readonly ValidRoles[],
    complexIdOverride?: string,
  ): Promise<TokenPair> {
    const sessionId = this.generateSecureId();
    const tokenFamily = this.generateSecureId();
    const accessToken = await this.generateAccessToken(
      user,
      sessionId,
      entityType,
      roleScope,
      complexIdOverride,
    );
    const refreshToken = await this.generateRefreshToken(
      user.id,
      sessionId,
      tokenFamily,
      deviceInfo,
      rememberMe,
      entityType,
      complexIdOverride,
      refreshExpiryOverride,
      roleScope,
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: this.getAccessTokenExpirySeconds(),
      sessionId,
    };
  }

  /**
   * Genera un par de tokens para un ResidentialComplex.
   * sub  = complex.id  (no el owner)
   * email = complex.email
   * tokenVersion = complex.tokenVersion
   * roles/permissions = del owner (complex.owner debe estar cargado)
   * El refresh token usa complex.ownerId como userId (FK a users).
   */
  async generateTokenPairForComplex(
    complex: ResidentialComplex,
    deviceInfo: DeviceInfo,
    rememberMe = false,
  ): Promise<TokenPair> {
    const sessionId = this.generateSecureId();
    const tokenFamily = this.generateSecureId();
    const accessToken = await this.generateAccessTokenForComplex(
      complex,
      sessionId,
    );
    const refreshToken = await this.generateRefreshToken(
      complex.ownerId,
      sessionId,
      tokenFamily,
      deviceInfo,
      rememberMe,
      'complex',
      complex.id,
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: this.getAccessTokenExpirySeconds(),
      sessionId,
    };
  }

  private async generateAccessTokenForComplex(
    complex: ResidentialComplex,
    sessionId: string,
  ): Promise<string> {
    const complexRole = await this.roleRepo.findOne({
      where: { name: ValidRoles.COMPLEX_ROL },
      relations: ['permissions'],
    });

    // Un permiso inactivo no entra al token aunque el rol lo tenga asignado.
    // COMPLEX_ROL no se puede inactivar (RolesService); si lo estuviera por
    // SQL, la cuenta sale sin rol ni permisos, igual que un usuario.
    const complexRoleActive = !!complexRole && complexRole.status !== false;
    const permissions: ValidPermissions[] = (
      complexRoleActive ? complexRole.permissions : []
    )
      .filter((p) => p.status !== false)
      .map((p) => p.name)
      .filter((p) => Object.values(ValidPermissions).includes(p));

    const payload: JwtAccessPayload = {
      sub: complex.id,
      email: complex.email ?? '',
      type: 'access',
      entityType: 'complex',
      tokenVersion: complex.tokenVersion ?? 0,
      sessionId,
      roles: complexRoleActive ? [ValidRoles.COMPLEX_ROL] : [],
      permissions,
      complexId: complex.id,
    };

    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const issuer = this.configService.get<string>('JWT_ISSUER');

    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: this.getAccessTokenExpiry(),
      issuer,
      algorithm: 'HS256',
    });
  }

  /**
   * `roleScope` limita la sesión a un subconjunto de los roles del usuario.
   * Sin él (undefined) salen todos, que es el comportamiento de siempre.
   * Los permisos se derivan DESPUÉS del recorte: si no, una cuenta que además
   * administra conservaría los permisos de administrador aunque el token
   * dijera que entró como residente.
   */
  private extractRoles(
    user: User,
    roleScope?: readonly ValidRoles[],
  ): ValidRoles[] {
    return this.scopedUserRoles(user, roleScope)
      .map((ur) => ur.role.name)
      .filter((role): role is ValidRoles =>
        Object.values(ValidRoles).includes(role),
      );
  }

  /**
   * Permisos de sus roles, más los GRANT, menos los DENY de sus excepciones.
   *
   * Un GRANT no aplica en una sesión acotada (`roleScope`): quien entró como
   * residente no gana privilegios por la excepción. Un DENY aplica siempre.
   */
  private extractPermissions(
    user: User,
    roleScope?: readonly ValidRoles[],
    overrides: readonly UserPermissionOverride[] = [],
  ): ValidPermissions[] {
    const perms = new Set<ValidPermissions>();
    // Un permiso inactivo no entra al token, ni por un rol (aunque esté
    // asignado) ni por una excepción GRANT. DENY sigue quitando siempre.
    this.scopedUserRoles(user, roleScope).forEach((ur) => {
      ur.role?.permissions?.forEach((p) => {
        if (
          p.status !== false &&
          Object.values(ValidPermissions).includes(p.name)
        ) {
          perms.add(p.name);
        }
      });
    });

    for (const o of overrides) {
      const name = o.permission?.name;
      if (!name || !Object.values(ValidPermissions).includes(name)) continue;
      if (o.effect === PermissionOverrideEffect.DENY) perms.delete(name);
      else if (!roleScope && o.permission?.status !== false) perms.add(name);
    }
    return Array.from(perms);
  }

  /**
   * Roles del usuario ya filtrados por el alcance de la sesión. Un rol
   * inactivo no entra: ni su nombre ni sus permisos van en el token (al
   * emitir ni al renovar). Una excepción GRANT no lo reactiva: solo agrega su
   * propio permiso, si está activo.
   */
  private scopedUserRoles(user: User, roleScope?: readonly ValidRoles[]) {
    if (!user.userRoles?.length) return [];

    return user.userRoles
      .filter((ur) => ur.role && ur.role.status !== false)
      .filter(
        (ur) => !roleScope || roleScope.includes(ur.role.name as ValidRoles),
      );
  }

  private async generateAccessToken(
    user: User,
    sessionId: string,
    entityType: 'user' | 'complex' = 'user',
    roleScope?: readonly ValidRoles[],
    complexIdOverride?: string,
  ): Promise<string> {
    const payload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      type: 'access',
      entityType,
      tokenVersion: user.tokenVersion ?? 0,
      sessionId,
      roles: this.extractRoles(user, roleScope),
      permissions: this.extractPermissions(
        user,
        roleScope,
        await this.permissionOverrideRepo.find({
          where: { userId: user.id },
          relations: ['permission'],
        }),
      ),
      // El del canal manda sobre el de la cuenta: quien entra como residente lo
      // hace al conjunto donde vive, que no es el de `users.complex_id`.
      complexId: complexIdOverride ?? user.complexId ?? undefined,
    };

    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const issuer = this.configService.get<string>('JWT_ISSUER');

    // VULN-12 fix: algoritmo explícito
    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: this.getAccessTokenExpiry(),
      issuer,
      algorithm: 'HS256',
    });
  }

  private async generateRefreshToken(
    userId: string,
    sessionId: string,
    tokenFamily: string,
    deviceInfo: DeviceInfo,
    rememberMe: boolean,
    entityType: 'user' | 'complex' = 'user',
    complexId?: string,
    refreshExpiryOverride?: RefreshExpiry,
    roleScope?: readonly ValidRoles[],
  ): Promise<string> {
    const tokenId = this.generateSecureId();
    const expiresIn =
      refreshExpiryOverride ?? this.getRefreshTokenExpiry(rememberMe);

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: userId,
        type: 'refresh',
        entityType,
        complexId,
        sessionId,
        tokenFamily,
        deviceFingerprint: deviceInfo.fingerprint,
      } as JwtRefreshPayload,

      // VULN-12 fix: algoritmo explícito
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn,
        jwtid: tokenId,
        algorithm: 'HS256',
      },
    );

    await this.refreshTokenRepo.save({
      id: tokenId,
      userId,
      tokenHash: this.hashToken(refreshToken),
      tokenFamily,
      sessionId,
      deviceFingerprint: deviceInfo.fingerprint,
      deviceInfo: {
        userAgent: deviceInfo.userAgent,
        ip: deviceInfo.ip,
        platform: deviceInfo.platform,
        deviceId: deviceInfo.deviceId,
        appVersion: deviceInfo.appVersion,
      },
      expiresAt: this.calculateExpiry(expiresIn),
      lastUsedAt: new Date(),
      rememberMe,
      refreshExpiry: expiresIn,
      roleScope: roleScope ? [...roleScope] : null,
    });
    return refreshToken;
  }

  /**
   * Rota el refresh token. Con `opts.complexIdOverride` además cambia el
   * conjunto de la sesión (selector de RemoteLink): misma familia, sesión,
   * alcance y vigencia; solo para sesiones de residente del mismo usuario y
   * con residencia activa en el destino. Un cambio rechazado no revoca nada.
   */
  async rotateRefreshToken(
    currentToken: string,
    deviceInfo: DeviceInfo,
    opts?: { complexIdOverride?: string; requesterUserId?: string },
  ): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(currentToken);
    const switchTo = opts?.complexIdOverride;
    const switching = !!switchTo;
    const currentTokenHash = this.hashToken(currentToken);

    const storedToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash: currentTokenHash, isRevoked: false },
      relations: [
        'user',
        'user.userRoles',
        'user.userRoles.role',
        'user.userRoles.role.permissions',
      ],
    });

    if (!storedToken) {
      // Grace window: concurrent request arrived after first rotation already completed.
      // Return the same token pair idempotently instead of triggering family revocation.
      const gracePayload = await this.cacheService.get<{
        accessToken: string;
        refreshToken: string;
        sessionId: string;
        complexId?: string;
      }>({
        key: {
          prefix: AUTH_CONSTANTS.CACHE_PREFIX.GRACE_WINDOW,
          key: currentTokenHash,
        },
      });

      if (gracePayload) {
        // Reintento del mismo cambio (la respuesta se perdió): mismo par,
        // igual que una renovación. Si el par en gracia es de otro conjunto,
        // devolverlo haría creer a la app que cambió: que reintente.
        if (switching && gracePayload.complexId !== switchTo) {
          throw new CustomError({
            message: 'No se pudo cambiar de conjunto. Intenta de nuevo',
            statusCode: HttpStatus.CONFLICT,
            errorCode: AuthErrorCode.COMPLEX_SWITCH_NOT_ALLOWED,
          });
        }
        return {
          accessToken: gracePayload.accessToken,
          refreshToken: gracePayload.refreshToken,
          sessionId: gracePayload.sessionId,
          expiresIn: this.getAccessTokenExpirySeconds(),
        };
      }

      // Outside grace window → genuine reuse attack or expired token → revoke family
      await this.revokeTokenFamily(payload.tokenFamily, 'token_reuse_detected');
      throw new CustomError({
        message: 'Token inválido',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.TOKEN_REUSE_DETECTED,
      });
    }

    // La huella anterior también vale: la sesión se abrió con la fórmula que
    // incluía el user-agent, y actualizar la app no puede cerrarla.
    const fingerprintMatches =
      storedToken.deviceFingerprint === deviceInfo.fingerprint ||
      (!!deviceInfo.legacyFingerprint &&
        storedToken.deviceFingerprint === deviceInfo.legacyFingerprint);

    if (!fingerprintMatches) {
      await this.revokeTokenFamily(payload.tokenFamily, 'fingerprint_mismatch');
      throw new CustomError({
        message: 'Sesión invalidada',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_FINGERPRINT_MISMATCH,
      });
    }

    const entityType = payload.entityType ?? 'user';

    // La renovación mira el estado vigente de la cuenta, igual que el login:
    // sin esto, un usuario suspendido seguía renovando su sesión hasta que el
    // refresh token vencía (hasta 180 días).
    if (
      entityType !== 'complex' &&
      (!storedToken.user ||
        storedToken.user.deletedAt ||
        !isUserStatusOperable(storedToken.user.status))
    ) {
      await this.revokeTokenFamily(payload.tokenFamily, 'user_not_active');
      throw new CustomError({
        message: 'Tu cuenta no está activa. Contacta al administrador',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_TERMINATED,
      });
    }

    if (switchTo) {
      const allowed =
        entityType === 'user' &&
        !!storedToken.roleScope &&
        storedToken.user?.id === opts?.requesterUserId;
      if (!allowed) {
        throw new CustomError({
          message: 'Esta sesión no puede cambiar de conjunto',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: AuthErrorCode.COMPLEX_SWITCH_NOT_ALLOWED,
        });
      }
      if (
        !this.residentTenancy ||
        !(await this.residentTenancy.hasActiveResidence(
          storedToken.user.id,
          switchTo,
        ))
      ) {
        throw new CustomError({
          message: 'Ya no tienes una residencia activa en ese conjunto',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: AuthErrorCode.RESIDENCE_NOT_AVAILABLE,
        });
      }
    }
    const sessionComplexId = switchTo ?? payload.complexId;
    // COUNCIL_ROL es del usuario, no de un conjunto: no se sabe si es consejero
    // en el destino, así que el token del otro conjunto sale sin él.
    const sessionRoleScope = switchTo
      ? (storedToken.roleScope ?? []).filter(
          (r) => r !== ValidRoles.COUNCIL_ROL,
        )
      : storedToken.roleScope;

    // Una sesión de residente solo se renueva mientras su residencia en ese
    // conjunto siga activa: suspender la ficha corta el acceso a ese conjunto
    // aunque el refresh token sea anterior a la suspensión.
    if (
      !switching &&
      entityType !== 'complex' &&
      storedToken.roleScope &&
      payload.complexId &&
      this.residentTenancy &&
      !(await this.residentTenancy.hasActiveResidence(
        storedToken.user.id,
        payload.complexId,
      ))
    ) {
      await this.revokeTokenFamily(payload.tokenFamily, 'residence_not_active');
      throw new CustomError({
        message:
          'Tu residencia en este conjunto está suspendida. Contacta a la administración',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.SESSION_TERMINATED,
      });
    }

    await this.refreshTokenRepo.update(storedToken.id, {
      isRevoked: true,
      revokedReason: switching ? 'complex_switched' : 'rotated',
      lastUsedAt: new Date(),
    });
    const tokenId = this.generateSecureId();

    // La vigencia con la que nació la sesión manda sobre el default: rotar no
    // debe convertir una sesión de residente de 180d en una de 7d.
    // El cast es seguro: esta columna solo la escribe generateRefreshToken con
    // un valor de RefreshExpiry, y calculateExpiry rechaza cualquier formato raro.
    const refreshExpiry =
      (storedToken.refreshExpiry as RefreshExpiry) ??
      this.getRefreshTokenExpiry(storedToken.rememberMe);

    let accessToken: string;
    let newRefreshToken: string;

    if (entityType === 'complex' && payload.complexId) {
      // Recargar el complejo con el owner para reconstruir el token de complejo
      const complex = await this.complexRepo
        .createQueryBuilder('complex')
        .leftJoinAndSelect('complex.owner', 'owner')
        .leftJoinAndSelect('owner.userRoles', 'userRoles')
        .leftJoinAndSelect('userRoles.role', 'role')
        .leftJoinAndSelect('role.permissions', 'permissions')
        .where('complex.id = :id', { id: payload.complexId })
        .andWhere('complex.deleted_at IS NULL')
        .getOne();

      if (!complex)
        throw new CustomError({
          message: 'Complejo no encontrado o eliminado',
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
        });

      accessToken = await this.generateAccessTokenForComplex(
        complex,
        storedToken.sessionId,
      );

      // VULN-12 fix: algoritmo explícito en rotación de refresh token
      newRefreshToken = await this.jwtService.signAsync(
        {
          sub: storedToken.user.id,
          type: 'refresh',
          entityType,
          complexId: complex.id,
          sessionId: storedToken.sessionId,
          tokenFamily: payload.tokenFamily,
          deviceFingerprint: deviceInfo.fingerprint,
        } as JwtRefreshPayload,
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshExpiry,
          jwtid: tokenId,
          algorithm: 'HS256',
        },
      );
    } else {
      accessToken = await this.generateAccessToken(
        storedToken.user,
        storedToken.sessionId,
        'user',
        sessionRoleScope ?? undefined,
        sessionComplexId,
      );
      newRefreshToken = await this.jwtService.signAsync(
        {
          sub: storedToken.user.id,
          type: 'refresh',
          entityType: 'user',
          // El complejo de la sesión viaja con la familia de tokens: sin esto,
          // la sesión de residente de quien administra perdería su conjunto en
          // el primer refresh y se quedaría sin unidad ni notificaciones.
          complexId: sessionComplexId,
          sessionId: storedToken.sessionId,
          tokenFamily: payload.tokenFamily,
          deviceFingerprint: deviceInfo.fingerprint,
        } as JwtRefreshPayload,

        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshExpiry,
          jwtid: tokenId,
          algorithm: 'HS256',
        },
      );
    }

    await this.refreshTokenRepo.save({
      id: tokenId,
      userId: storedToken.user.id,
      tokenHash: this.hashToken(newRefreshToken),
      tokenFamily: payload.tokenFamily,
      previousTokenHash: currentTokenHash,
      previousTokenValidUntil: new Date(
        Date.now() + AUTH_CONSTANTS.GRACE_WINDOW_MS,
      ),
      sessionId: storedToken.sessionId,
      deviceFingerprint: deviceInfo.fingerprint,
      deviceInfo: {
        userAgent: deviceInfo.userAgent,
        ip: deviceInfo.ip,
        platform: deviceInfo.platform,
      },
      expiresAt: this.calculateExpiry(refreshExpiry),
      lastUsedAt: new Date(),
      rememberMe: storedToken.rememberMe,
      refreshExpiry,
      // El alcance viaja con la familia de tokens: rotar no puede devolverle
      // a una sesión de residente los roles administrativos de la cuenta.
      roleScope: sessionRoleScope ?? null,
    });

    // Cache the result so concurrent requests with the old token are served idempotently
    // within the grace window instead of triggering family revocation.
    await this.cacheService.set({
      key: {
        prefix: AUTH_CONSTANTS.CACHE_PREFIX.GRACE_WINDOW,
        key: currentTokenHash,
      },
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        sessionId: storedToken.sessionId,
        complexId: sessionComplexId,
      },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.GRACE_WINDOW },
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.getAccessTokenExpirySeconds(),
      sessionId: storedToken.sessionId,
    };
  }

  async verifyRefreshToken(token: string): Promise<JwtRefreshPayload> {
    const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(
      token,
      { secret: this.configService.get<string>('JWT_REFRESH_SECRET') },
    );
    if (payload.type !== 'refresh')
      throw new CustomError({
        message: 'Tipo de token inválido',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.INVALID_TOKEN_TYPE,
      });
    return payload;
  }

  async verifyAccessToken(token: string): Promise<JwtAccessPayload> {
    const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
    });
    if (payload.type !== 'access')
      throw new CustomError({
        message: 'Tipo de token inválido',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.INVALID_TOKEN_TYPE,
      });
    if (await this.isTokenBlacklisted(token))
      throw new CustomError({
        message: 'Token revocado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.TOKEN_REVOKED,
      });
    return payload;
  }

  async blacklistAccessToken(token: string, expiresAt: Date): Promise<void> {
    const ttl = Math.max(
      0,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    if (ttl > 0) {
      await this.cacheService.set({
        key: {
          prefix: AUTH_CONSTANTS.CACHE_PREFIX.BLACKLIST,
          key: this.hashToken(token),
        },
        data: { revoked: true },
        options: { ttl },
      });
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await this.cacheService.get<{ revoked: boolean }>({
      key: {
        prefix: AUTH_CONSTANTS.CACHE_PREFIX.BLACKLIST,
        key: this.hashToken(token),
      },
    });
    return result?.revoked === true;
  }

  async getUserTokenVersion(userId: string): Promise<number | null> {
    const result = await this.cacheService.get<{ version: number }>({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.TOKEN_VERSION, key: userId },
    });
    return result?.version ?? null;
  }

  async setUserTokenVersion(userId: string, version: number): Promise<void> {
    await this.cacheService.set({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.TOKEN_VERSION, key: userId },
      data: { version },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.TOKEN_VERSION },
    });
  }

  async clearUserTokenVersionCache(userId: string): Promise<void> {
    await this.cacheService.delete({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.TOKEN_VERSION, key: userId },
    });
  }

  async revokeTokenFamily(tokenFamily: string, reason: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { tokenFamily, isRevoked: false },
      { isRevoked: true, revokedReason: reason },
    );
  }

  async revokeAllUserTokens(userId: string, reason: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { userId, isRevoked: false },
      { isRevoked: true, revokedReason: reason },
    );
  }

  /**
   * Cierra las sesiones de un usuario después de cambiar su contraseña.
   *
   * Subir `tokenVersion` no basta: la versión vive 5 minutos en caché, y la
   * rotación del refresh token no la mira, así que quien tuviera una sesión
   * abierta —por ejemplo con una contraseña filtrada— la seguía renovando y
   * recibía tokens nuevos con la versión nueva. Aquí se revocan sus refresh
   * tokens y se limpia la caché para que el access token viejo muera ya.
   *
   * `exceptSessionId` conserva la sesión desde la que el usuario cambió su
   * propia contraseña: su access token caduca por la versión, el cliente
   * renueva con ese refresh token y sigue trabajando sin volver a entrar.
   */
  async invalidateUserSessions(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<void> {
    await this.refreshTokenRepo.update(
      exceptSessionId
        ? { userId, isRevoked: false, sessionId: Not(exceptSessionId) }
        : { userId, isRevoked: false },
      { isRevoked: true, revokedReason: reason },
    );
    await this.clearUserTokenVersionCache(userId);
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { sessionId, isRevoked: false },
      { isRevoked: true, revokedReason: reason },
    );
  }

  /**
   * Borra los refresh tokens que ya no pueden usarse: los vencidos y los
   * revocados con más de `revokedRetentionDays` días.
   *
   * Cada rotación (cada ~15 min por equipo activo) deja una fila revocada, así
   * que la tabla crece sola. Ninguna lectura depende de esas filas: la
   * detección de reuso sale de la familia del JWT y de la ventana de gracia en
   * caché. Se conservan unos días solo para poder investigar una sesión.
   */
  async cleanupExpiredTokens(revokedRetentionDays = 7): Promise<number> {
    const revokedBefore = new Date(
      Date.now() - revokedRetentionDays * 86_400_000,
    );
    const expired = await this.refreshTokenRepo.delete({
      expiresAt: LessThan(new Date()),
    });
    const revoked = await this.refreshTokenRepo.delete({
      isRevoked: true,
      createdAt: LessThan(revokedBefore),
    });
    return (expired.affected || 0) + (revoked.affected || 0);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateSecureId(): string {
    return uuidv4();
  }

  private calculateExpiry(expiresIn: string): Date {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error('Invalid expiry');
    const mult: Record<string, number> = {
      s: 1000,
      m: 60000,
      h: 3600000,
      d: 86400000,
    };
    return new Date(Date.now() + parseInt(match[1]) * mult[match[2]]);
  }
  private getAccessTokenExpiry(): typeof AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY {
    return (this.configService.get<string>('JWT_ACCESS_EXPIRY') ??
      AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY) as typeof AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY;
  }

  private getRefreshTokenExpiry(
    rememberMe: boolean,
  ):
    | typeof AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY
    | typeof AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY_REMEMBER {
    const value = rememberMe
      ? (this.configService.get<string>('JWT_REFRESH_EXPIRY_REMEMBER') ??
        AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY_REMEMBER)
      : (this.configService.get<string>('JWT_REFRESH_EXPIRY') ??
        AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY);
    return value as
      | typeof AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY
      | typeof AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY_REMEMBER;
  }

  private getAccessTokenExpirySeconds(): number {
    const match = this.getAccessTokenExpiry().match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(match[1]) * mult[match[2]];
  }
}
