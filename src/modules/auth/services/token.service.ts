// modules/auth/services/token.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Role } from '../../roles/entities/role.entity';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { JwtAccessPayload, JwtRefreshPayload, DeviceInfo, TokenPair } from '../interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { v4 as uuidv4 } from 'uuid';

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
  ) { }

  async generateTokenPair(user: User, deviceInfo: DeviceInfo, rememberMe = false, entityType: 'user' | 'complex' = 'user'): Promise<TokenPair> {
    const sessionId = this.generateSecureId();
    const tokenFamily = this.generateSecureId();
    const accessToken = await this.generateAccessToken(user, sessionId, entityType);
    const refreshToken = await this.generateRefreshToken(user.id, sessionId, tokenFamily, deviceInfo, rememberMe, entityType);
    return { accessToken, refreshToken, expiresIn: this.getAccessTokenExpirySeconds(), sessionId };
  }

  /**
   * Genera un par de tokens para un ResidentialComplex.
   * sub  = complex.id  (no el owner)
   * email = complex.email
   * tokenVersion = complex.tokenVersion
   * roles/permissions = del owner (complex.owner debe estar cargado)
   * El refresh token usa complex.ownerId como userId (FK a users).
   */
  async generateTokenPairForComplex(complex: ResidentialComplex, deviceInfo: DeviceInfo, rememberMe = false): Promise<TokenPair> {
    const sessionId = this.generateSecureId();
    const tokenFamily = this.generateSecureId();
    const accessToken = await this.generateAccessTokenForComplex(complex, sessionId);
    const refreshToken = await this.generateRefreshToken(
      complex.ownerId,
      sessionId,
      tokenFamily,
      deviceInfo,
      rememberMe,
      'complex',
      complex.id,
    );
    return { accessToken, refreshToken, expiresIn: this.getAccessTokenExpirySeconds(), sessionId };
  }

  private async generateAccessTokenForComplex(complex: ResidentialComplex, sessionId: string): Promise<string> {
    const complexRole = await this.roleRepo.findOne({
      where: { name: ValidRoles.COMPLEX_ROL },
      relations: ['permissions'],
    });

    const permissions: ValidPermissions[] = (complexRole?.permissions ?? [])
      .map(p => p.name as ValidPermissions)
      .filter(p => Object.values(ValidPermissions).includes(p));

    const payload: JwtAccessPayload = {
      sub: complex.id,
      email: complex.email ?? '',
      type: 'access',
      entityType: 'complex',
      tokenVersion: complex.tokenVersion ?? 0,
      sessionId,
      roles: [ValidRoles.COMPLEX_ROL],
      permissions,
      complexId: complex.id,
    };

    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const issuer = this.configService.get<string>('JWT_ISSUER');


    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY,
      issuer,
      algorithm: 'HS256',

    });
  }

  private extractRoles(user: User): ValidRoles[] {
    if (!user.userRoles?.length) return [];
    return user.userRoles
      .filter(ur => ur.role)
      .map(ur => ur.role.name as ValidRoles)
      .filter((role): role is ValidRoles => Object.values(ValidRoles).includes(role));
  }

  private extractPermissions(user: User): ValidPermissions[] {
    if (!user.userRoles?.length) return [];
    const perms = new Set<ValidPermissions>();
    user.userRoles.forEach(ur => {
      ur.role?.permissions?.forEach(p => {
        if (Object.values(ValidPermissions).includes(p.name as ValidPermissions)) {
          perms.add(p.name as ValidPermissions);
        }
      });
    });
    return Array.from(perms);
  }

private async generateAccessToken(user: User, sessionId: string, entityType: 'user' | 'complex' = 'user'): Promise<string> {
  const payload: JwtAccessPayload = {
    sub: user.id,
    email: user.email,
    type: 'access',
    entityType,
    tokenVersion: user.tokenVersion ?? 0,
    sessionId,
    roles: this.extractRoles(user),
    permissions: this.extractPermissions(user),
    complexId: user.complexId ?? undefined,
  };

  const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
  const issuer = this.configService.get<string>('JWT_ISSUER');

  // VULN-12 fix: algoritmo explícito
  return this.jwtService.signAsync(payload, {
    secret,
    expiresIn: AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY,
    issuer,
    algorithm: 'HS256',
  });
}

  private async generateRefreshToken(userId: string, sessionId: string, tokenFamily: string, deviceInfo: DeviceInfo, rememberMe: boolean, entityType: 'user' | 'complex' = 'user', complexId?: string): Promise<string> {
    const tokenId = this.generateSecureId();
    const expiresIn = rememberMe ? AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY_REMEMBER : AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY;

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, type: 'refresh', entityType, complexId, sessionId, tokenFamily, deviceFingerprint: deviceInfo.fingerprint } as JwtRefreshPayload,

      // VULN-12 fix: algoritmo explícito
      { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn, jwtid: tokenId, algorithm: 'HS256' }
    );

    await this.refreshTokenRepo.save({
      id: tokenId, userId, tokenHash: this.hashToken(refreshToken), tokenFamily, sessionId,
      deviceFingerprint: deviceInfo.fingerprint,
      deviceInfo: { userAgent: deviceInfo.userAgent, ip: deviceInfo.ip, platform: deviceInfo.platform, deviceId: deviceInfo.deviceId, appVersion: deviceInfo.appVersion },
      expiresAt: this.calculateExpiry(expiresIn), lastUsedAt: new Date(),
      rememberMe,
    });
    return refreshToken;
  }

  async rotateRefreshToken(currentToken: string, deviceInfo: DeviceInfo): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(currentToken);
    const currentTokenHash = this.hashToken(currentToken);

    const storedToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash: currentTokenHash, isRevoked: false },
      relations: ['user', 'user.userRoles', 'user.userRoles.role', 'user.userRoles.role.permissions'],
    });

    if (!storedToken) {
      // Grace window: concurrent request arrived after first rotation already completed.
      // Return the same token pair idempotently instead of triggering family revocation.
      const gracePayload = await this.cacheService.get<{ accessToken: string; refreshToken: string; sessionId: string }>({
        key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.GRACE_WINDOW, key: currentTokenHash },
      });

      if (gracePayload) {
        return { ...gracePayload, expiresIn: this.getAccessTokenExpirySeconds() };
      }

      // Outside grace window → genuine reuse attack or expired token → revoke family
      await this.revokeTokenFamily(payload.tokenFamily, 'token_reuse_detected');
      throw new UnauthorizedException('Token inválido');
    }

    if (storedToken.deviceFingerprint !== deviceInfo.fingerprint) {
      await this.revokeTokenFamily(payload.tokenFamily, 'fingerprint_mismatch');
      throw new UnauthorizedException('Sesión invalidada');
    }

    await this.refreshTokenRepo.update(storedToken.id, { isRevoked: true, revokedReason: 'rotated', lastUsedAt: new Date() });

    const entityType = payload.entityType ?? 'user';
    const tokenId = this.generateSecureId();

    const refreshExpiry = storedToken.rememberMe
      ? AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY_REMEMBER
      : AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY;

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

      if (!complex) throw new UnauthorizedException('Complejo no encontrado o eliminado');

      accessToken = await this.generateAccessTokenForComplex(complex, storedToken.sessionId);

      // VULN-12 fix: algoritmo explícito en rotación de refresh token
      newRefreshToken = await this.jwtService.signAsync(
        { sub: storedToken.user.id, type: 'refresh', entityType, complexId: complex.id, sessionId: storedToken.sessionId, tokenFamily: payload.tokenFamily, deviceFingerprint: deviceInfo.fingerprint } as JwtRefreshPayload,
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: refreshExpiry, jwtid: tokenId, algorithm: 'HS256' }
      );
    } else {
      accessToken = await this.generateAccessToken(storedToken.user, storedToken.sessionId, 'user');
      newRefreshToken = await this.jwtService.signAsync(
        { sub: storedToken.user.id, type: 'refresh', entityType: 'user', sessionId: storedToken.sessionId, tokenFamily: payload.tokenFamily, deviceFingerprint: deviceInfo.fingerprint } as JwtRefreshPayload,

        { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: refreshExpiry, jwtid: tokenId, algorithm: 'HS256' }
      );
    }

    await this.refreshTokenRepo.save({
      id: tokenId, userId: storedToken.user.id, tokenHash: this.hashToken(newRefreshToken), tokenFamily: payload.tokenFamily,
      previousTokenHash: currentTokenHash,
      previousTokenValidUntil: new Date(Date.now() + AUTH_CONSTANTS.GRACE_WINDOW_MS),
      sessionId: storedToken.sessionId, deviceFingerprint: deviceInfo.fingerprint,
      deviceInfo: { userAgent: deviceInfo.userAgent, ip: deviceInfo.ip, platform: deviceInfo.platform },
      expiresAt: this.calculateExpiry(refreshExpiry), lastUsedAt: new Date(),
      rememberMe: storedToken.rememberMe,
    });

    // Cache the result so concurrent requests with the old token are served idempotently
    // within the grace window instead of triggering family revocation.
    await this.cacheService.set({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.GRACE_WINDOW, key: currentTokenHash },
      data: { accessToken, refreshToken: newRefreshToken, sessionId: storedToken.sessionId },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.GRACE_WINDOW },
    });

    return { accessToken, refreshToken: newRefreshToken, expiresIn: this.getAccessTokenExpirySeconds(), sessionId: storedToken.sessionId };
  }

  async verifyRefreshToken(token: string): Promise<JwtRefreshPayload> {
    const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(token, { secret: this.configService.get<string>('JWT_REFRESH_SECRET') });
    if (payload.type !== 'refresh') throw new UnauthorizedException('Tipo de token inválido');
    return payload;
  }

  async verifyAccessToken(token: string): Promise<JwtAccessPayload> {
    const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, { secret: this.configService.get<string>('JWT_ACCESS_SECRET') });
    if (payload.type !== 'access') throw new UnauthorizedException('Tipo de token inválido');
    if (await this.isTokenBlacklisted(token)) throw new UnauthorizedException('Token revocado');
    return payload;
  }

  async blacklistAccessToken(token: string, expiresAt: Date): Promise<void> {
    const ttl = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    if (ttl > 0) {
      await this.cacheService.set({
        key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.BLACKLIST, key: this.hashToken(token) },
        data: { revoked: true },
        options: { ttl },
      });
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await this.cacheService.get<{ revoked: boolean }>({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.BLACKLIST, key: this.hashToken(token) },
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
    await this.cacheService.delete({ key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.TOKEN_VERSION, key: userId } });
  }

  async revokeTokenFamily(tokenFamily: string, reason: string): Promise<void> {
    await this.refreshTokenRepo.update({ tokenFamily, isRevoked: false }, { isRevoked: true, revokedReason: reason });
  }

  async revokeAllUserTokens(userId: string, reason: string): Promise<void> {
    await this.refreshTokenRepo.update({ userId, isRevoked: false }, { isRevoked: true, revokedReason: reason });
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.refreshTokenRepo.update({ sessionId, isRevoked: false }, { isRevoked: true, revokedReason: reason });
  }

  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.refreshTokenRepo.delete({ expiresAt: LessThan(new Date()) });
    return result.affected || 0;
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
    const mult: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return new Date(Date.now() + parseInt(match[1]) * mult[match[2]]);
  }
  private getAccessTokenExpirySeconds(): number {
    const match = AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY.match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(match[1]) * mult[match[2]];
  }
}