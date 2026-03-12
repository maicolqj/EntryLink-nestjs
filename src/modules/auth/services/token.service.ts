// modules/auth/services/token.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { User } from '../../users/entities/user.entity';
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
  ) { }

  async generateTokenPair(user: User, deviceInfo: DeviceInfo, rememberMe = false): Promise<TokenPair> {
    const sessionId = this.generateSecureId();
    const tokenFamily = this.generateSecureId();
    const accessToken = await this.generateAccessToken(user, sessionId);
    const refreshToken = await this.generateRefreshToken(user.id, sessionId, tokenFamily, deviceInfo, rememberMe);
    return { accessToken, refreshToken, expiresIn: this.getAccessTokenExpirySeconds(), sessionId };
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

private async generateAccessToken(user: User, sessionId: string): Promise<string> {
  const payload: JwtAccessPayload = {
    sub: user.id,
    email: user.email,
    type: 'access',
    tokenVersion: user.tokenVersion ?? 0,
    sessionId,
    roles: this.extractRoles(user),
    permissions: this.extractPermissions(user),
    complexId: user.complexId ?? undefined,
  };

  const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
  const issuer = this.configService.get<string>('JWT_ISSUER');
  
  // 🔍 DEBUG - Remover después
  this.logger.debug(`=== GENERANDO ACCESS TOKEN ===`);
  this.logger.debug(`Secret definido: ${!!secret}`);
  this.logger.debug(`Secret length: ${secret?.length}`);
  this.logger.debug(`Issuer: ${issuer}`);
  this.logger.debug(`ExpiresIn: ${AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY}`);

  const token = await this.jwtService.signAsync(payload, {
    secret,
    expiresIn: AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY,
    issuer,
  });

  // 🔍 DEBUG - Verificar token generado
  const decoded = this.jwtService.decode(token) as any;
  this.logger.debug(`Token IAT: ${new Date(decoded.iat * 1000).toISOString()}`);
  this.logger.debug(`Token EXP: ${new Date(decoded.exp * 1000).toISOString()}`);
  this.logger.debug(`Ahora: ${new Date().toISOString()}`);
  this.logger.debug(`==============================`);

  return token;
}

  private async generateRefreshToken(userId: string, sessionId: string, tokenFamily: string, deviceInfo: DeviceInfo, rememberMe: boolean): Promise<string> {
    const tokenId = this.generateSecureId();
    const expiresIn = rememberMe ? AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY_REMEMBER : AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY;

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, type: 'refresh', sessionId, tokenFamily, deviceFingerprint: deviceInfo.fingerprint } as JwtRefreshPayload,
      { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn, jwtid: tokenId }
    );

    await this.refreshTokenRepo.save({
      id: tokenId, userId, tokenHash: this.hashToken(refreshToken), tokenFamily, sessionId,
      deviceFingerprint: deviceInfo.fingerprint,
      deviceInfo: { userAgent: deviceInfo.userAgent, ip: deviceInfo.ip, platform: deviceInfo.platform, deviceId: deviceInfo.deviceId, appVersion: deviceInfo.appVersion },
      expiresAt: this.calculateExpiry(expiresIn), lastUsedAt: new Date(),
    });
    return refreshToken;
  }

  async rotateRefreshToken(currentToken: string, deviceInfo: DeviceInfo): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(currentToken);
    const storedToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash: this.hashToken(currentToken), isRevoked: false },
      relations: ['user', 'user.userRoles', 'user.userRoles.role', 'user.userRoles.role.permissions'],
    });

    if (!storedToken) {
      await this.revokeTokenFamily(payload.tokenFamily, 'token_reuse_detected');
      throw new UnauthorizedException('Token inválido');
    }

    if (storedToken.deviceFingerprint !== deviceInfo.fingerprint) {
      await this.revokeTokenFamily(payload.tokenFamily, 'fingerprint_mismatch');
      throw new UnauthorizedException('Sesión invalidada');
    }
  
    await this.refreshTokenRepo.update(storedToken.id, { isRevoked: true, revokedReason: 'rotated', lastUsedAt: new Date() });

    const accessToken = await this.generateAccessToken(storedToken.user, storedToken.sessionId);
    const tokenId = this.generateSecureId();
    const refreshToken = await this.jwtService.signAsync(
      { sub: storedToken.user.id, type: 'refresh', sessionId: storedToken.sessionId, tokenFamily: payload.tokenFamily, deviceFingerprint: deviceInfo.fingerprint },
      { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY, jwtid: tokenId }
    );

    await this.refreshTokenRepo.save({
      id: tokenId, userId: storedToken.user.id, tokenHash: this.hashToken(refreshToken), tokenFamily: payload.tokenFamily,
      sessionId: storedToken.sessionId, deviceFingerprint: deviceInfo.fingerprint,
      deviceInfo: { userAgent: deviceInfo.userAgent, ip: deviceInfo.ip, platform: deviceInfo.platform },
      expiresAt: this.calculateExpiry(AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY), lastUsedAt: new Date(),
    });

    return { accessToken, refreshToken, expiresIn: this.getAccessTokenExpirySeconds(), sessionId: storedToken.sessionId };
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