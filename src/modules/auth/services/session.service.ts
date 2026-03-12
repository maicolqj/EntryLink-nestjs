// modules/auth/services/session.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { UserSession, SessionStatus } from '../entities/user-session.entity';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../constants/auth.constants';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(UserSession) private readonly sessionRepo: Repository<UserSession>,
    private readonly cacheService: CacheService,

  ) { }

  async createOrUpdateSession(
    userId: string,
    sessionId: string,
    deviceInfo: DeviceInfo,
  ): Promise<UserSession> {
    this.logger.debug(`=== CREANDO SESIÓN ===`);
    this.logger.debug(`userId: ${userId}`);
    this.logger.debug(`sessionId del token: ${sessionId}`);
    this.logger.debug(`fingerprint: ${deviceInfo.fingerprint}`);

    // 1. Buscar sesión existente por fingerprint
    const existingSession = await this.sessionRepo.findOne({
      where: {
        userId,
        deviceFingerprint: deviceInfo.fingerprint,
        status: SessionStatus.ACTIVE,
      },
    });

    // 2. Si existe una sesión anterior para este dispositivo, terminarla
    if (existingSession) {
      this.logger.debug(`Terminando sesión anterior: ${existingSession.id}`);

      await this.sessionRepo.update(
        { id: existingSession.id },
        { status: SessionStatus.LOGGED_OUT },
      );

      await this.cacheService.delete({
        key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SESSION, key: existingSession.id },
      });
    }

    // 3. SIEMPRE crear nueva sesión con el sessionId del token
    const newSession = this.sessionRepo.create({
      id: sessionId,  // ← USAR EL sessionId QUE VIENE DEL TOKEN
      userId,
      deviceFingerprint: deviceInfo.fingerprint,
      deviceInfo: {
        userAgent: deviceInfo.userAgent,
        ip: deviceInfo.ip,
        platform: deviceInfo.platform,
        deviceId: deviceInfo.deviceId,
        appVersion: deviceInfo.appVersion,
      },
      status: SessionStatus.ACTIVE,
      lastActivityAt: new Date(),
      lastIp: deviceInfo.ip,
    });

    const savedSession = await this.sessionRepo.save(newSession);

    this.logger.debug(`Sesión guardada con ID: ${savedSession.id}`);
    this.logger.debug(`¿IDs coinciden?: ${savedSession.id === sessionId}`);

    // 4. Cachear la sesión
    await this.cacheService.set({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SESSION, key: sessionId },
      data: { status: SessionStatus.ACTIVE },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.SESSION },
    });

    this.logger.debug(`=== FIN CREACIÓN SESIÓN ===`);

    return savedSession;
  }
  async enforceSessionLimit(userId: string, maxSessions: number): Promise<void> {
    const sessions = await this.sessionRepo.find({
      where: { userId, status: SessionStatus.ACTIVE },
      order: { lastActivityAt: 'ASC' },
    });
    if (sessions.length >= maxSessions) {
      const toTerminate = sessions.slice(0, sessions.length - maxSessions + 1);
      for (const s of toTerminate) await this.terminateSession(s.id);
    }
  }

  async terminateSession(sessionId: string): Promise<boolean> {
    const result = await this.sessionRepo.update(sessionId, { status: SessionStatus.LOGGED_OUT });
    await this.cacheService.delete({ key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SESSION, key: sessionId } });
    return (result.affected || 0) > 0;
  }

  async terminateAllUserSessions(userId: string): Promise<number> {
    const sessions = await this.sessionRepo.find({ where: { userId, status: SessionStatus.ACTIVE }, select: ['id'] });
    const result = await this.sessionRepo.update({ userId, status: SessionStatus.ACTIVE }, { status: SessionStatus.LOGGED_OUT });
    for (const s of sessions) {
      await this.cacheService.delete({ key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SESSION, key: s.id } });
    }
    return result.affected || 0;
  }

  async terminateOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    const sessions = await this.sessionRepo.find({
      where: { userId, status: SessionStatus.ACTIVE, id: Not(currentSessionId) },
      select: ['id'],
    });
    if (!sessions.length) return 0;
    const result = await this.sessionRepo.update({ id: In(sessions.map(s => s.id)) }, { status: SessionStatus.LOGGED_OUT });
    for (const s of sessions) {
      await this.cacheService.delete({ key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SESSION, key: s.id } });
    }
    return result.affected || 0;
  }



  async getUserActiveSessions(userId: string, currentSessionId?: string): Promise<(UserSession & { isCurrent: boolean })[]> {
    const sessions = await this.sessionRepo.find({
      where: {
        userId,
        status: SessionStatus.ACTIVE
      },
      order: { lastActivityAt: 'DESC' },
    });

    return sessions.map(session => ({
      ...session,
      isCurrent: session.id === currentSessionId,
    }));
  }


  // modules/auth/services/session.service.ts

  async isSessionActive(sessionId: string): Promise<boolean> {
    // 🔍 DEBUG
    this.logger.debug(`=== VERIFICANDO SESIÓN ACTIVA ===`);
    this.logger.debug(`sessionId a verificar: ${sessionId}`);

    // 1. Verificar en cache primero
    const cachedStatus = await this.cacheService.get<{ status: string }>({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SESSION, key: sessionId },
    });

    this.logger.debug(`Cache encontrado: ${!!cachedStatus}`);
    if (cachedStatus) {
      this.logger.debug(`Status en cache: ${cachedStatus.status}`);
    }

    if (cachedStatus) {
      const isActive = cachedStatus.status === SessionStatus.ACTIVE;
      this.logger.debug(`Resultado desde cache: ${isActive}`);
      return isActive;
    }

    // 2. Si no está en cache, verificar en BD
    this.logger.debug(`No en cache, buscando en BD...`);

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      select: ['id', 'status'],
    });

    this.logger.debug(`Sesión en BD: ${!!session}`);
    if (session) {
      this.logger.debug(`Status en BD: ${session.status}`);
    }

    if (!session) {
      this.logger.debug(`Sesión NO encontrada en BD`);
      return false;
    }

    // 3. Cachear el resultado
    await this.cacheService.set({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SESSION, key: sessionId },
      data: { status: session.status },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.SESSION },
    });

    const isActive = session.status === SessionStatus.ACTIVE;
    this.logger.debug(`Resultado final: ${isActive}`);
    this.logger.debug(`=== FIN VERIFICACIÓN ===`);

    return isActive;
  }

  async getActiveSessionsCount(userId: string): Promise<number> {
    return this.sessionRepo.count({ where: { userId, status: SessionStatus.ACTIVE } });
  }

  async updateSessionActivity(sessionId: string, ip: string): Promise<void> {
    await this.sessionRepo.update(sessionId, { lastActivityAt: new Date(), lastIp: ip });
  }

  async isSessionOwnedByUser(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
      select: ['id'],
    });

    return !!session;
  }
}