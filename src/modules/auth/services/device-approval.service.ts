import { Injectable, Logger, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In, Not } from 'typeorm';
import { randomInt, randomUUID } from 'crypto';

import { DeviceApprovalRequest } from '../entities/device-approval-request.entity';
import { DeviceApprovalStatus } from '../enums/device-approval-status.enum';
import { ResidentDevice } from '../entities/resident-device.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { ResidentDeviceService } from './resident-device.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { AuthResponse } from '../dto/responses/auth-response';
import { DeviceApprovalResponse } from '../dto/responses/device-approval.response';
import { DeviceApprovalStatusResponse } from '../dto/responses/device-approval-status.response';
import { PendingDeviceApproval } from '../dto/responses/pending-device-approval.response';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode, UserErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Ingreso aprobado desde un dispositivo confiable, avisado por push.
 *
 * Es el canal más barato de los cuatro: FCM y Web Push no cobran por mensaje y
 * la infraestructura ya existe (PushSubscription). Cubre al residente que
 * cambió de equipo o perdió su PIN pero conserva la aplicación instalada en
 * otro dispositivo, sin tocar WhatsApp.
 *
 * Secuencia:
 *   1. `requestApproval(documento)` → código de 4 caracteres en pantalla y push
 *      a todos los dispositivos vinculados del residente.
 *   2. El residente abre la app en un equipo donde ya tiene sesión, compara el
 *      código con el de la pantalla nueva y llama a `approve` o `deny`.
 *   3. `redeem(challengeId)` entrega los tokens al dispositivo solicitante.
 *
 * La comparación de códigos (number matching) es lo que impide la aprobación
 * a ciegas: un atacante puede disparar la solicitud, pero no puede hacer que
 * el código de su pantalla aparezca en el push de la víctima.
 */
@Injectable()
export class DeviceApprovalService {
  private readonly logger = new Logger(DeviceApprovalService.name);

  constructor(
    @InjectRepository(DeviceApprovalRequest)
    private readonly approvalRepo: Repository<DeviceApprovalRequest>,
    @InjectRepository(ResidentDevice)
    private readonly deviceRepo: Repository<ResidentDevice>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly residentDeviceService: ResidentDeviceService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Paso 1: pedir aprobación ──────────────────────────────────────────────

  /**
   * Emite la solicitud y avisa por push a los dispositivos del residente.
   *
   * La respuesta es idéntica exista o no la identidad, y no revela cuántos
   * dispositivos se notificaron: decir "0 dispositivos" convertiría el
   * endpoint en un oráculo de qué documentos están registrados. Si nadie puede
   * aprobar, la solicitud simplemente vence.
   */
  async requestApproval(
    identity: string,
    deviceInfo: DeviceInfo,
  ): Promise<DeviceApprovalResponse> {
    const identityKey = identity.trim().toLowerCase();
    await this.checkRateLimit(identityKey);

    const user = await this.findResidentByIdentity(identityKey);

    // Un solo intento vivo por identidad: si el residente pidió dos, no debe
    // tener que adivinar cuál de los códigos en pantalla es el vigente.
    await this.approvalRepo.update(
      { identity: identityKey, status: DeviceApprovalStatus.PENDING },
      { status: DeviceApprovalStatus.EXPIRED, resolvedAt: new Date() },
    );

    const approvalCode = this.generateCode();
    const expiresAt = new Date(Date.now() + AUTH_CONSTANTS.DEVICE_APPROVAL_EXPIRY_SECONDS * 1_000);
    const requestedFromLabel = this.describeDevice(deviceInfo);

    const request = await this.approvalRepo.save(
      this.approvalRepo.create({
        approvalId: randomUUID(),
        approvalCode,
        identity: identityKey,
        userId: user?.id,
        status: DeviceApprovalStatus.PENDING,
        expiresAt,
        deviceFingerprint: deviceInfo.fingerprint,
        requestedFromLabel,
        requestedFromIp: deviceInfo.ip,
      }),
    );

    if (user) await this.pushApprovalRequest(user, request);

    this.logger.log(
      `Solicitud de aprobación emitida — id: ${request.id} | vinculado: ${user ? 'sí' : 'no'}`,
    );

    return {
      challengeId: request.id,
      approvalCode,
      expiresAt,
      instructions:
        'Abre EntryLink en un dispositivo donde ya tengas sesión y aprueba el ingreso. ' +
        `Verifica que el código mostrado allí sea ${approvalCode} antes de aprobar.`,
    };
  }

  // ── Paso 2: resolver desde el dispositivo confiable ───────────────────────

  /** Solicitudes pendientes del residente autenticado, por si perdió el push. */
  async listPending(userId: string): Promise<PendingDeviceApproval[]> {
    const pending = await this.approvalRepo.find({
      where: { userId, status: DeviceApprovalStatus.PENDING },
      order: { createdAt: 'DESC' },
    });

    return pending
      .filter(request => new Date() <= request.expiresAt)
      .map(request => ({
        approvalId: request.approvalId,
        approvalCode: request.approvalCode,
        requestedFromLabel: request.requestedFromLabel,
        requestedFromIp: request.requestedFromIp,
        expiresAt: request.expiresAt,
        createdAt: request.createdAt,
      }));
  }

  /** Aprueba el ingreso. Solo el dueño de la solicitud puede hacerlo. */
  async approve(approvalId: string, userId: string, sessionId: string): Promise<boolean> {
    const request = await this.findResolvableRequest(approvalId, userId);

    await this.approvalRepo.update(request.id, {
      status: DeviceApprovalStatus.APPROVED,
      resolvedAt: new Date(),
      resolvedBySessionId: sessionId,
    });

    this.logger.log(`Ingreso aprobado — id: ${request.id} | userId: ${userId}`);
    return true;
  }

  /**
   * Rechaza el ingreso. Es terminal: el solicitante no puede reintentar con la
   * misma solicitud, tiene que pedir una nueva y volver a pasar por el push.
   */
  async deny(approvalId: string, userId: string, sessionId: string): Promise<boolean> {
    const request = await this.findResolvableRequest(approvalId, userId);

    await this.approvalRepo.update(request.id, {
      status: DeviceApprovalStatus.DENIED,
      resolvedAt: new Date(),
      resolvedBySessionId: sessionId,
    });

    // Un rechazo significa que alguien más intentó entrar con este documento.
    this.logger.warn(
      `Ingreso RECHAZADO por el residente — id: ${request.id} | userId: ${userId} | ` +
      `origen: ${request.requestedFromLabel ?? 'desconocido'} | ip: ${request.requestedFromIp ?? 'desconocida'}`,
    );
    return true;
  }

  // ── Paso 3: estado y canje ────────────────────────────────────────────────

  /** Consulta el estado. El dispositivo solicitante hace polling hasta APPROVED. */
  async getStatus(challengeId: string, deviceInfo: DeviceInfo): Promise<DeviceApprovalStatusResponse> {
    const request = await this.findRequestForDevice(challengeId, deviceInfo);

    if (request.status === DeviceApprovalStatus.PENDING && new Date() > request.expiresAt) {
      await this.approvalRepo.update(request.id, { status: DeviceApprovalStatus.EXPIRED });
      return { status: DeviceApprovalStatus.EXPIRED, expiresAt: request.expiresAt };
    }

    return { status: request.status, expiresAt: request.expiresAt };
  }

  /** Canjea una solicitud aprobada por una sesión. Un solo uso. */
  async redeem(
    challengeId: string,
    deviceInfo: DeviceInfo,
    accessCode?: string,
  ): Promise<AuthResponse> {
    const request = await this.findRequestForDevice(challengeId, deviceInfo);

    this.assertRedeemable(request);

    // Marcar consumido ANTES de emitir tokens: si entran dos peticiones a la
    // vez, solo la que gana el UPDATE condicional sigue adelante.
    const consumed = await this.approvalRepo.update(
      { id: request.id, status: DeviceApprovalStatus.APPROVED },
      { status: DeviceApprovalStatus.CONSUMED },
    );

    if (!consumed.affected) {
      throw new CustomError({
        message: 'Esta solicitud de ingreso ya fue usada',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.APPROVAL_CONSUMED,
      });
    }

    const user = await this.loadResidentWithRoles(request.userId);
    this.assertUserActive(user);

    // Igual que en el WhatsApp entrante: si la cuenta ya tiene clave, aprobar
    // desde el otro equipo no alcanza para vincular este. Hacen falta las dos
    // cosas, la aprobación y el conocimiento de la clave.
    const hasCode = await this.residentDeviceService.hasAccessCode(user.id);
    if (hasCode) {
      if (!accessCode?.trim()) {
        throw new CustomError({
          message: 'Ingresa tu clave de acceso para autorizar este dispositivo',
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: AuthErrorCode.ACCESS_CODE_REQUIRED,
        });
      }
      await this.residentDeviceService.verifyAccessCode(user.id, accessCode);
    }

    await this.residentDeviceService.linkDevice(user.id, deviceInfo);

    await this.sessionService.enforceSessionLimit(user.id, AUTH_CONSTANTS.MAX_SESSIONS_PER_USER);

    const tokenPair = await this.tokenService.generateTokenPair(user, deviceInfo, false, 'user');

    await this.sessionService.createOrUpdateSession(user.id, tokenPair.sessionId, deviceInfo);

    this.logger.log(`Login por aprobación push — userId: ${user.id} | sessionId: ${tokenPair.sessionId}`);

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      sessionId: tokenPair.sessionId,
    };
  }

  /** Borra las solicitudes ya resueltas o vencidas. Para un cron de limpieza. */
  async cleanupExpired(): Promise<number> {
    const result = await this.approvalRepo.delete({
      expiresAt: LessThan(new Date()),
      status: Not(DeviceApprovalStatus.APPROVED),
    });
    return result.affected ?? 0;
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  /**
   * Envía el push a los dispositivos vinculados del residente.
   *
   * Sin persistir notificación: el payload lleva un código de un solo uso que
   * no debe quedar en el buzón ni volver a mostrarse una vez resuelto.
   *
   * No lanza: si el push falla, la solicitud sigue viva y el residente puede
   * resolverla desde `pendingDeviceApprovals`. Romper el login porque FCM está
   * caído sería peor que entregar el aviso tarde.
   */
  private async pushApprovalRequest(user: User, request: DeviceApprovalRequest): Promise<void> {
    try {
      const hasLinkedDevice = await this.deviceRepo.count({
        where: { userId: user.id, isRevoked: false },
      });

      if (hasLinkedDevice === 0) {
        this.logger.warn(`[APPROVAL] Residente sin dispositivos vinculados — id: ${request.id}`);
        return;
      }

      await this.notificationsService.dispatchPushOnly([user.id], {
        complexId: user.complexId ?? '',
        userIds: [user.id],
        type: NotificationType.LOGIN_APPROVAL_REQUEST,
        priority: NotificationPriority.URGENT,
        title: 'Solicitud de ingreso a tu cuenta',
        body:
          `Alguien intenta entrar desde ${request.requestedFromLabel ?? 'un dispositivo desconocido'}. ` +
          `Código: ${request.approvalCode}. Si no eres tú, recházalo.`,
        metadata: {
          approvalId: request.approvalId,
          approvalCode: request.approvalCode,
          requestedFromLabel: request.requestedFromLabel ?? '',
          requestedFromIp: request.requestedFromIp ?? '',
          expiresAt: request.expiresAt.toISOString(),
        },
      });
    } catch (err: any) {
      this.logger.error(`[APPROVAL] Error enviando push — id: ${request.id}: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * Carga una solicitud que el usuario autenticado puede resolver.
   * Exige que sea suya: el `approvalId` viaja en un push, y aunque solo llega a
   * sus dispositivos, la propiedad se verifica igual contra el JWT.
   */
  private async findResolvableRequest(approvalId: string, userId: string): Promise<DeviceApprovalRequest> {
    const request = await this.approvalRepo.findOne({ where: { approvalId, userId } });

    if (!request) {
      throw new CustomError({
        message: 'Solicitud de ingreso no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AuthErrorCode.APPROVAL_NOT_FOUND,
      });
    }

    if (new Date() > request.expiresAt) {
      await this.approvalRepo.update(request.id, { status: DeviceApprovalStatus.EXPIRED });
      throw new CustomError({
        message: 'La solicitud de ingreso venció',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.APPROVAL_EXPIRED,
      });
    }

    if (request.status !== DeviceApprovalStatus.PENDING) {
      throw new CustomError({
        message: 'Esta solicitud de ingreso ya fue resuelta',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.APPROVAL_ALREADY_RESOLVED,
      });
    }

    return request;
  }

  /**
   * Carga la solicitud exigiendo el mismo dispositivo que la pidió. Mismo error
   * para "no existe" y "otro dispositivo": el cliente legítimo nunca ve esa
   * diferencia.
   */
  private async findRequestForDevice(
    challengeId: string,
    deviceInfo: DeviceInfo,
  ): Promise<DeviceApprovalRequest> {
    const request = await this.approvalRepo.findOne({ where: { id: challengeId } });

    if (!request || request.deviceFingerprint !== deviceInfo.fingerprint) {
      if (request) {
        this.logger.warn(`[APPROVAL] Acceso desde dispositivo distinto — id: ${request.id}`);
      }
      throw new CustomError({
        message: 'Solicitud de ingreso no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AuthErrorCode.APPROVAL_NOT_FOUND,
      });
    }

    return request;
  }

  private assertRedeemable(request: DeviceApprovalRequest): void {
    if (request.status === DeviceApprovalStatus.CONSUMED) {
      throw new CustomError({
        message: 'Esta solicitud de ingreso ya fue usada',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.APPROVAL_CONSUMED,
      });
    }

    if (request.status === DeviceApprovalStatus.DENIED) {
      throw new CustomError({
        message: 'El ingreso fue rechazado desde tu dispositivo de confianza',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.APPROVAL_DENIED,
      });
    }

    if (request.status === DeviceApprovalStatus.EXPIRED || new Date() > request.expiresAt) {
      throw new CustomError({
        message: 'La solicitud de ingreso venció. Solicita una nueva',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.APPROVAL_EXPIRED,
      });
    }

    if (request.status !== DeviceApprovalStatus.APPROVED) {
      throw new CustomError({
        message: 'Todavía no has aprobado este ingreso',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.APPROVAL_PENDING,
      });
    }
  }

  /**
   * Código corto de comparación. Alfabeto sin caracteres ambiguos porque el
   * residente lo lee en una pantalla y lo compara con otra.
   */
  private generateCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < AUTH_CONSTANTS.DEVICE_APPROVAL_CODE_LENGTH; i++) {
      code += alphabet[randomInt(0, alphabet.length)];
    }
    return code;
  }

  /** Descripción legible del equipo solicitante, para que el residente la juzgue. */
  private describeDevice(deviceInfo: DeviceInfo): string {
    const platform =
      deviceInfo.platform === 'ios' ? 'iPhone/iPad' :
      deviceInfo.platform === 'android' ? 'Android' :
      'un navegador web';

    const browser = /chrome/i.test(deviceInfo.userAgent) ? 'Chrome'
      : /firefox/i.test(deviceInfo.userAgent) ? 'Firefox'
      : /safari/i.test(deviceInfo.userAgent) ? 'Safari'
      : /edg/i.test(deviceInfo.userAgent) ? 'Edge'
      : null;

    return browser ? `${browser} en ${platform}` : platform;
  }

  private async checkRateLimit(identityKey: string): Promise<void> {
    const key = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.DEVICE_APPROVAL_RATE_LIMIT, key: identityKey };
    const data = await this.cacheService.get<{ count: number }>({ key });

    if ((data?.count ?? 0) >= AUTH_CONSTANTS.DEVICE_APPROVAL_RATE_LIMIT_MAX) {
      throw new CustomError({
        message: `Demasiadas solicitudes. Espera ${AUTH_CONSTANTS.DEVICE_APPROVAL_RATE_LIMIT_WINDOW / 60} minutos`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.APPROVAL_RATE_LIMIT,
      });
    }

    await this.cacheService.set({
      key,
      data: { count: (data?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.DEVICE_APPROVAL_RATE_LIMIT },
    });
  }

  /** Busca al residente por documento. Devuelve null sin lanzar: el caller no debe filtrar si existe. */
  private async findResidentByIdentity(identityKey: string): Promise<User | null> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .where('LOWER(user.identity) = :identity', { identity: identityKey })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) return null;

    const isResident = (user.userRoles ?? []).some(ur => ur.role?.name === ValidRoles.RESIDENT_ROL);

    return isResident ? user : null;
  }

  private async loadResidentWithRoles(userId: string): Promise<User> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('user.id = :userId', { userId })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    return user;
  }

  /** El estado de la cuenta se revalida al canjear: pudo suspenderse durante el flujo. */
  private assertUserActive(user: User): void {
    if (user.accountLockedUntil && new Date() < user.accountLockedUntil) {
      const unlockIn = Math.ceil((user.accountLockedUntil.getTime() - Date.now()) / 60_000);
      throw new CustomError({
        message: `Cuenta bloqueada temporalmente. Intenta en ${unlockIn} minuto(s)`,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.ACCOUNT_LOCKED,
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new CustomError({
        message: 'Tu cuenta no está activa. Contacta al administrador',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.USER_SUSPENDED,
      });
    }
  }
}
