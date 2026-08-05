import { Injectable, Logger, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { ResidentDevice } from '../entities/resident-device.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { AuthResponse } from '../dto/responses/auth-response';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode, UserErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Clave de acceso del residente y dispositivos vinculados.
 *
 * La clave es UNA por cuenta —no una por equipo— y reemplaza al `systemCode`
 * que antes emitía el sistema y enviaba por WhatsApp. La elige el residente en
 * su primer ingreso y le sirve en todos los dispositivos que ya haya vinculado.
 *
 * Modelo de seguridad:
 *   1. `deviceId` (header x-device-id) identifica el equipo y, con él, al dueño.
 *   2. `deviceFingerprint` (HMAC con llave del servidor) ata ese equipo al
 *      user-agent con el que se vinculó; no es falsificable desde el cliente.
 *   3. La clave se valida SIEMPRE contra bcrypt en el servidor. El cliente puede
 *      usar biometría del SO para desbloquearla localmente, pero eso no
 *      reemplaza esta verificación.
 *   4. Bloqueo temporal por intentos fallidos, contados en la CUENTA. Contarlos
 *      por dispositivo permitiría multiplicar los intentos con solo cambiar de
 *      equipo, que es justo lo que el límite intenta impedir.
 *
 * Alta de un equipo nuevo — dos caminos:
 *   a) Documento + clave (`identity` en el login). El vínculo del dispositivo
 *      dejó de ser un factor obligatorio porque los otros dos caminos fallan
 *      justo para quien más los necesita: el residente que reinstaló la app en
 *      su único celular no tiene otro equipo desde donde aprobar, y el canal de
 *      WhatsApp puede estar apagado. Como el documento no es secreto, este
 *      camino se compensa con: respuesta uniforme exista o no la identidad,
 *      freno por IP y por documento que NO bloquea la cuenta, y aviso por push a
 *      los equipos ya vinculados cada vez que entra uno nuevo.
 *   b) WhatsApp entrante o aprobación desde un equipo confiable, que además
 *      otorgan el permiso de restablecer la clave (el "olvidé mi clave").
 */
@Injectable()
export class ResidentDeviceService {
  private readonly logger = new Logger(ResidentDeviceService.name);

  constructor(
    @InjectRepository(ResidentDevice)
    private readonly deviceRepo: Repository<ResidentDevice>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Clave de acceso ───────────────────────────────────────────────────────

  /**
   * Fija o cambia la clave de la cuenta y vincula el dispositivo actual.
   *
   * Se invoca con sesión activa, así que la identidad ya está probada por el
   * flujo que la abrió (WhatsApp entrante o aprobación desde otro equipo).
   *
   * Cambiar la clave limpia el estado punitivo de la cuenta: quien llega hasta
   * aquí demostró quién es, no tiene sentido dejarlo bloqueado.
   */
  async setAccessCode(
    userId: string,
    code: string,
    deviceInfo: DeviceInfo,
    label?: string,
    currentCode?: string,
  ): Promise<ResidentDevice> {
    this.requireDeviceId(deviceInfo);
    const user = await this.findResident(userId);

    // Cambiar la clave exige conocer la anterior. Sin esto, una sesión abierta
    // en un teléfono desbloqueado y ajeno alcanzaría para apropiarse de la
    // cuenta: la sesión del residente dura 180 días.
    await this.assertMayChangeCode(user.id, currentCode);

    const normalized = this.normalizeCode(code);
    this.assertCodeIsAcceptable(normalized);

    await this.userRepo.update(user.id, {
      accessCodeHash: await bcrypt.hash(normalized, AUTH_CONSTANTS.ACCESS_CODE_BCRYPT_ROUNDS),
      accessCodeFailedAttempts: 0,
      accessCodeLockedUntil: null,
    });

    this.logger.log(`Clave de acceso actualizada — userId: ${user.id}`);

    return this.linkDevice(user.id, deviceInfo, label);
  }

  /**
   * Autoriza el cambio de clave.
   *
   * Si la cuenta todavía no tiene, no hay nada que confirmar. Si ya tiene, hay
   * dos caminos: conocer la clave actual, o traer un permiso de restablecimiento
   * vigente —que solo otorga un ingreso por WhatsApp entrante o por aprobación
   * desde otro equipo—. Ese segundo camino es el "olvidé mi clave": pedir la
   * anterior ahí dejaría al residente sin salida.
   */
  private async assertMayChangeCode(userId: string, currentCode?: string): Promise<void> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.accessCodeHash')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user?.accessCodeHash) return;

    if (await this.consumeResetPermission(userId)) return;

    if (!currentCode?.trim()) {
      throw new CustomError({
        message: 'Ingresa tu clave actual para cambiarla',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.CURRENT_ACCESS_CODE_REQUIRED,
      });
    }

    this.assertAccountNotLocked(user);

    const isValid = await bcrypt.compare(this.normalizeCode(currentCode), user.accessCodeHash);
    if (!isValid) await this.registerFailedAttempt(user);
  }

  /**
   * Otorga permiso temporal para fijar una clave nueva sin la anterior. Lo
   * llaman los flujos que ya probaron identidad por un canal externo.
   */
  async grantResetPermission(userId: string): Promise<void> {
    await this.cacheService.set({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.ACCESS_CODE_RESET, key: userId },
      data: { granted: true },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.ACCESS_CODE_RESET },
    });
  }

  /** Un solo uso: se borra al consumirlo para que no quede vivo 15 minutos. */
  private async consumeResetPermission(userId: string): Promise<boolean> {
    const key = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.ACCESS_CODE_RESET, key: userId };
    const permission = await this.cacheService.get<{ granted: boolean }>({ key });

    if (!permission?.granted) return false;

    await this.cacheService.delete({ key });
    return true;
  }

  /**
   * ¿El equipo que hace la petición ya está vinculado a esta cuenta?
   *
   * Los flujos de arranque lo usan para decidir si exigir la clave: el segundo
   * factor protege el alta de un equipo NUEVO. Pedirlo en uno ya vinculado
   * rompería la recuperación de quien justamente olvidó la clave.
   */
  async isDeviceLinked(userId: string, deviceInfo: DeviceInfo): Promise<boolean> {
    const deviceId = deviceInfo.deviceId?.trim();
    if (!deviceId) return false;

    const device = await this.deviceRepo.findOne({
      where: { userId, deviceId, isRevoked: false },
    });

    return !!device && device.deviceFingerprint === deviceInfo.fingerprint;
  }

  /** ¿La cuenta ya tiene clave? El cliente lo usa para exigir su creación. */
  async hasAccessCode(userId: string): Promise<boolean> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.accessCodeHash')
      .where('user.id = :userId', { userId })
      .getOne();

    return !!user?.accessCodeHash;
  }

  /**
   * Vincula el dispositivo actual sin tocar la clave. Lo llaman los flujos de
   * arranque (WhatsApp entrante y aprobación) una vez que probaron identidad:
   * el equipo nuevo hereda la clave que la cuenta ya tenía, en vez de pedir una
   * distinta por dispositivo.
   */
  async linkDevice(
    userId: string,
    deviceInfo: DeviceInfo,
    label?: string,
  ): Promise<ResidentDevice> {
    const deviceId = this.requireDeviceId(deviceInfo);

    const existing = await this.deviceRepo.findOne({ where: { userId, deviceId } });

    if (existing) {
      await this.deviceRepo.update(existing.id, {
        deviceFingerprint: deviceInfo.fingerprint,
        platform: deviceInfo.platform,
        label: label ?? existing.label,
        isRevoked: false,
        revokedReason: null,
      });
      return this.deviceRepo.findOne({ where: { id: existing.id } });
    }

    await this.enforceDeviceLimit(userId);

    const device = await this.deviceRepo.save(
      this.deviceRepo.create({
        userId,
        deviceId,
        deviceFingerprint: deviceInfo.fingerprint,
        platform: deviceInfo.platform,
        label,
      }),
    );

    this.logger.log(`Dispositivo vinculado — userId: ${userId} | deviceId: ${this.maskDeviceId(deviceId)}`);
    return device;
  }

  /**
   * Verifica la clave de una cuenta sin abrir sesión.
   *
   * Lo usan los flujos de arranque para exigir el segundo factor al vincular un
   * equipo nuevo: quien roba el teléfono se lleva también la línea de WhatsApp,
   * así que la posesión sola no debe alcanzar cuando la cuenta ya tiene clave.
   */
  async verifyAccessCode(userId: string, code: string): Promise<void> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.accessCodeHash')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user?.accessCodeHash) {
      throw new CustomError({
        message: 'Esta cuenta todavía no tiene clave de acceso',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.ACCESS_CODE_NOT_SET,
      });
    }

    this.assertAccountNotLocked(user);

    const isValid = await bcrypt.compare(this.normalizeCode(code), user.accessCodeHash);
    if (!isValid) await this.registerFailedAttempt(user);

    await this.userRepo.update(user.id, {
      accessCodeFailedAttempts: 0,
      accessCodeLockedUntil: null,
    });
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  /**
   * Inicia sesión con la clave de la cuenta. Cero mensajes salientes.
   *
   * Dos caminos según el equipo:
   *   · Ya vinculado → basta la clave; `identity` se ignora.
   *   · Sin vincular → hace falta `identity`, y el ingreso vincula el equipo.
   *
   * Los dos difieren en cómo castigan el fallo, y la diferencia es deliberada:
   * desde un equipo vinculado el fallo bloquea la CUENTA, porque llegar hasta
   * ahí ya exigió poseer el equipo. Desde uno sin vincular alcanza con conocer
   * un documento, así que bloquear la cuenta convertiría el endpoint en un DoS
   * contra todo el conjunto; ese camino se frena aparte, sin tocar la cuenta.
   */
  async loginWithAccessCode(
    code: string,
    deviceInfo: DeviceInfo,
    identity?: string,
    label?: string,
  ): Promise<AuthResponse> {
    const deviceId = this.requireDeviceId(deviceInfo);
    const identityKey = identity?.trim().toLowerCase() || undefined;

    const device = await this.findLinkedDevice(deviceId, deviceInfo, identityKey);

    if (device) return this.loginFromLinkedDevice(code, deviceInfo, device);

    if (!identityKey) {
      throw new CustomError({
        message:
          'Este dispositivo no está vinculado. Ingresa tu número de identidad junto con la clave para vincularlo',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.DEVICE_NOT_LINKED,
      });
    }

    return this.loginAndLinkDevice(code, deviceInfo, identityKey, label);
  }

  /**
   * Ingreso desde un equipo ya vinculado: la clave es lo único que falta.
   * El fallo cuenta contra el bloqueo de la cuenta.
   */
  private async loginFromLinkedDevice(
    code: string,
    deviceInfo: DeviceInfo,
    device: ResidentDevice,
  ): Promise<AuthResponse> {
    const user = await this.findResident(device.userId);
    this.assertUserActive(user);
    this.assertAccountNotLocked(user);

    const withHash = await this.loadAccessCodeHash(user.id);

    if (!withHash?.accessCodeHash) {
      throw new CustomError({
        message: 'Tu cuenta todavía no tiene clave. Ingresa con WhatsApp para crearla',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.ACCESS_CODE_NOT_SET,
      });
    }

    const isValid = await bcrypt.compare(this.normalizeCode(code), withHash.accessCodeHash);
    if (!isValid) await this.registerFailedAttempt(withHash);

    return this.issueDeviceSession(user, device, deviceInfo);
  }

  /**
   * Ingreso desde un equipo sin vincular: documento + clave, y el equipo queda
   * vinculado. Es el camino de vuelta del residente que reinstaló la app.
   *
   * Un solo mensaje de error para "documento inexistente", "cuenta sin clave" y
   * "clave incorrecta": distinguirlos convertiría el endpoint en un oráculo de
   * qué documentos están registrados, que es justo lo que evitan
   * `requestWhatsAppLoginChallenge` y `requestDeviceApproval`.
   */
  private async loginAndLinkDevice(
    code: string,
    deviceInfo: DeviceInfo,
    identityKey: string,
    label?: string,
  ): Promise<AuthResponse> {
    await this.assertEnrollmentAllowed(identityKey, deviceInfo.ip);

    const candidate = await this.findResidentByIdentity(identityKey);
    const withHash = candidate ? await this.loadAccessCodeHash(candidate.id) : null;

    const isValid =
      !!withHash?.accessCodeHash &&
      (await bcrypt.compare(this.normalizeCode(code), withHash.accessCodeHash));

    if (!isValid) {
      await this.registerEnrollmentFailure(identityKey);
      throw new CustomError({
        message:
          'Documento o clave incorrectos. Si nunca creaste una clave, ingresa con WhatsApp o pide ' +
          'aprobación desde otro equipo',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.ACCESS_CODE_INVALID,
      });
    }

    // El estado de la cuenta se revisa DESPUÉS de la clave: antes, "cuenta
    // suspendida" delataría que el documento existe sin conocer nada más.
    const user = await this.findResident(candidate!.id);
    this.assertUserActive(user);
    this.assertAccountNotLocked(user);

    await this.clearEnrollmentFailures(identityKey);

    const device = await this.linkDevice(user.id, deviceInfo, label);

    this.logger.warn(
      `Equipo nuevo vinculado con documento + clave — userId: ${user.id} | ` +
      `deviceId: ${this.maskDeviceId(device.deviceId)} | ip: ${deviceInfo.ip}`,
    );

    // Best-effort y ANTES de emitir tokens no: si el aviso falla, el ingreso
    // sigue. Es la mitigación que hace visible un robo de cuenta, no un paso
    // del que dependa la sesión.
    await this.notifyNewDeviceLinked(user, device, deviceInfo);

    return this.issueDeviceSession(user, device, deviceInfo);
  }

  /**
   * Emite la sesión del residente sobre un dispositivo ya vinculado. Común a los
   * dos caminos de login para que ninguno olvide cerrar la sesión anterior ni
   * limpiar el estado punitivo de la cuenta.
   */
  private async issueDeviceSession(
    user: User,
    device: ResidentDevice,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    // Un dispositivo sostiene una sola sesión: al volver a entrar se cierra la
    // anterior para no dejar refresh tokens huérfanos vivos 180 días.
    if (device.sessionId) {
      await this.tokenService.revokeSession(device.sessionId, 'device_relogin');
    }

    await this.sessionService.enforceSessionLimit(user.id, AUTH_CONSTANTS.MAX_SESSIONS_PER_USER);

    const tokenPair = await this.tokenService.generateTokenPair(
      user,
      deviceInfo,
      true,
      'user',
      AUTH_CONSTANTS.RESIDENT_DEVICE_REFRESH_EXPIRY,
    );

    await this.sessionService.createOrUpdateSession(user.id, tokenPair.sessionId, deviceInfo);

    await this.userRepo.update(user.id, {
      accessCodeFailedAttempts: 0,
      accessCodeLockedUntil: null,
    });

    await this.deviceRepo.update(device.id, {
      lastUsedAt: new Date(),
      sessionId: tokenPair.sessionId,
    });

    this.logger.log(`Login con clave de acceso — userId: ${user.id} | sessionId: ${tokenPair.sessionId}`);

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      sessionId: tokenPair.sessionId,
    };
  }

  /**
   * Busca el vínculo vigente de este equipo, o null si hay que crearlo.
   *
   * Con `identityKey` la búsqueda se acota al dueño declarado. Sin él hay que
   * resolver el deviceId a ciegas, y un mismo deviceId puede existir en varias
   * cuentas (la unicidad es por user_id + device_id): un teléfono que pasó de un
   * residente a otro tiene dos filas y `getOne()` devolvería cualquiera.
   */
  private async findLinkedDevice(
    deviceId: string,
    deviceInfo: DeviceInfo,
    identityKey?: string,
  ): Promise<ResidentDevice | null> {
    let device: ResidentDevice | null = null;

    if (identityKey) {
      const owner = await this.findResidentByIdentity(identityKey);
      if (!owner) return null;
      device = await this.deviceRepo.findOne({
        where: { userId: owner.id, deviceId, isRevoked: false },
      });
    } else {
      device = await this.deviceRepo
        .createQueryBuilder('device')
        .where('device.device_id = :deviceId', { deviceId })
        .andWhere('device.is_revoked = false')
        .getOne();
    }

    if (!device) return null;

    // Fingerprint distinto: el equipo cambió de user-agent o alguien reusa el
    // deviceId. No es motivo para negar el ingreso —el camino con documento +
    // clave revalida y reescribe el vínculo—, pero sí para dejar rastro.
    if (device.deviceFingerprint !== deviceInfo.fingerprint) {
      this.logger.warn(`Fingerprint no coincide — deviceId: ${this.maskDeviceId(deviceId)}`);
      return null;
    }

    return device;
  }

  // ── Gestión ───────────────────────────────────────────────────────────────

  /** Dispositivos vinculados del residente autenticado. */
  async listDevices(userId: string): Promise<ResidentDevice[]> {
    return this.deviceRepo.find({
      where: { userId, isRevoked: false },
      order: { lastUsedAt: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Desvincula un dispositivo (celular perdido o robado) y cierra su sesión.
   * Solo mata la sesión de ESE equipo: los otros dispositivos del residente
   * siguen funcionando.
   */
  async revokeDevice(userId: string, deviceRowId: string): Promise<boolean> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceRowId, userId } });

    if (!device) {
      throw new CustomError({
        message: 'Dispositivo no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AuthErrorCode.DEVICE_NOT_FOUND,
      });
    }

    await this.deviceRepo.update(device.id, {
      isRevoked: true,
      revokedReason: 'revoked_by_user',
    });

    if (device.sessionId) {
      await this.tokenService.revokeSession(device.sessionId, 'device_revoked');
      await this.sessionService.terminateSession(device.sessionId).catch(() => undefined);
    }

    this.logger.log(`Dispositivo revocado por el usuario — userId: ${userId} | id: ${device.id}`);
    return true;
  }

  /**
   * Deja vinculado solo el dispositivo actual y cierra las demás sesiones.
   *
   * Es la respuesta al celular perdido: el residente entra desde el equipo nuevo
   * y corta de raíz el acceso del anterior, sin depender de que recuerde cuál
   * era. Equivale al "cerrar sesión en los demás dispositivos" de una cuenta de
   * correo.
   */
  async revokeOtherDevices(userId: string, deviceInfo: DeviceInfo): Promise<number> {
    const currentDeviceId = this.requireDeviceId(deviceInfo);

    const others = await this.deviceRepo.find({ where: { userId, isRevoked: false } });
    const toRevoke = others.filter(device => device.deviceId !== currentDeviceId);

    for (const device of toRevoke) {
      await this.deviceRepo.update(device.id, {
        isRevoked: true,
        revokedReason: 'revoked_by_user',
      });
      if (device.sessionId) {
        await this.tokenService.revokeSession(device.sessionId, 'device_revoked');
        await this.sessionService.terminateSession(device.sessionId).catch(() => undefined);
      }
    }

    this.logger.log(`Otros dispositivos revocados — userId: ${userId} | cantidad: ${toRevoke.length}`);
    return toRevoke.length;
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private requireDeviceId(deviceInfo: DeviceInfo): string {
    const deviceId = deviceInfo.deviceId?.trim();

    if (!deviceId) {
      throw new CustomError({
        message: 'Falta el identificador del dispositivo (header x-device-id)',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.DEVICE_ID_REQUIRED,
      });
    }
    return deviceId;
  }

  /** Mayúsculas y sin espacios: ver el comentario de ACCESS_CODE_LENGTH. */
  private normalizeCode(code: string): string {
    return (code ?? '').trim().toUpperCase();
  }

  /** El hash está marcado `select: false`: hay que pedirlo explícitamente. */
  private async loadAccessCodeHash(userId: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.accessCodeHash')
      .where('user.id = :userId', { userId })
      .getOne();
  }

  /**
   * Busca al residente por documento. Devuelve null sin lanzar: el caller no
   * debe filtrar si el documento existe.
   */
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

  // ── Frenos del alta de equipos nuevos ─────────────────────────────────────
  //
  // Deliberadamente separados del bloqueo de cuenta. Agotar el contador aquí
  // cierra SOLO el camino de "documento + clave desde un equipo nuevo": los
  // dispositivos ya vinculados siguen entrando, y por eso un tercero con una
  // lista de cédulas no puede dejar a nadie sin acceso.

  private enrollmentIpKey(ip: string) {
    return { prefix: AUTH_CONSTANTS.CACHE_PREFIX.UNLINKED_LOGIN_IP, key: ip || 'sin-ip' };
  }

  private enrollmentIdentityKey(identityKey: string) {
    return { prefix: AUTH_CONSTANTS.CACHE_PREFIX.UNLINKED_LOGIN_IDENTITY, key: identityKey };
  }

  /**
   * El contador por IP suma en CADA intento —acertado o no—, porque lo que
   * limita es cuántos documentos puede probar una misma fuente. El contador por
   * documento suma solo en los fallos, para no castigar al residente que entra
   * bien varias veces desde equipos distintos.
   */
  private async assertEnrollmentAllowed(identityKey: string, ip: string): Promise<void> {
    const minutes = AUTH_CONSTANTS.UNLINKED_LOGIN_WINDOW / 60;

    const byIdentity = await this.cacheService.get<{ count: number }>({
      key: this.enrollmentIdentityKey(identityKey),
    });

    if ((byIdentity?.count ?? 0) >= AUTH_CONSTANTS.UNLINKED_LOGIN_IDENTITY_MAX) {
      throw new CustomError({
        message:
          `Demasiados intentos de vincular un equipo nuevo con este documento. Espera ${minutes} ` +
          'minutos, o entra desde un dispositivo que ya tengas vinculado',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.DEVICE_ENROLLMENT_THROTTLED,
      });
    }

    const byIp = await this.cacheService.get<{ count: number }>({ key: this.enrollmentIpKey(ip) });

    if ((byIp?.count ?? 0) >= AUTH_CONSTANTS.UNLINKED_LOGIN_IP_MAX) {
      this.logger.warn(`[ENROLL] Límite por IP alcanzado — ip: ${ip}`);
      throw new CustomError({
        message: `Demasiados intentos desde esta conexión. Espera ${minutes} minutos`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.DEVICE_ENROLLMENT_THROTTLED,
      });
    }

    await this.cacheService.set({
      key: this.enrollmentIpKey(ip),
      data: { count: (byIp?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.UNLINKED_LOGIN },
    });
  }

  private async registerEnrollmentFailure(identityKey: string): Promise<void> {
    const key = this.enrollmentIdentityKey(identityKey);
    const data = await this.cacheService.get<{ count: number }>({ key });

    await this.cacheService.set({
      key,
      data: { count: (data?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.UNLINKED_LOGIN },
    });
  }

  private async clearEnrollmentFailures(identityKey: string): Promise<void> {
    await this.cacheService.delete({ key: this.enrollmentIdentityKey(identityKey) });
  }

  /**
   * Avisa al residente que un equipo nuevo entró a su cuenta.
   *
   * Es la mitigación que compensa haber quitado el vínculo del dispositivo como
   * factor obligatorio: sin este aviso, quien conoce el documento y la clave
   * entra sin dejar rastro visible. Se persiste (no es push efímero) para que
   * quede en el buzón aunque el push no llegue.
   *
   * No lanza: un fallo de FCM no puede tumbar un login legítimo.
   */
  private async notifyNewDeviceLinked(
    user: User,
    device: ResidentDevice,
    deviceInfo: DeviceInfo,
  ): Promise<void> {
    const params = {
      complexId: user.complexId ?? '',
      userIds: [user.id],
      type: NotificationType.NEW_DEVICE_LINKED,
      priority: NotificationPriority.URGENT,
      title: 'Nuevo dispositivo en tu cuenta',
      body:
        `Se vinculó ${device.label ?? 'un dispositivo'} con tu documento y tu clave. ` +
        'Si no fuiste tú, cambia tu clave y desvincúlalo desde Dispositivos vinculados.',
      entityId: device.id,
      entityType: 'ResidentDevice',
      metadata: {
        deviceId: device.id,
        label: device.label ?? null,
        platform: deviceInfo.platform,
        ip: deviceInfo.ip,
      },
    };

    try {
      // `notify` exige complejo para persistir la fila; sin él queda el push,
      // que es lo que hace visible el ingreso en el momento.
      if (user.complexId) await this.notificationsService.notify(params);
      else await this.notificationsService.dispatchPushOnly([user.id], params);
    } catch (err: any) {
      this.logger.error(
        `[ENROLL] No se pudo avisar del equipo nuevo — userId: ${user.id}: ${err?.message ?? String(err)}`,
      );
    }
  }

  /**
   * Rechaza las claves que un atacante probaría primero. Exigir letra Y dígito
   * evita que el espacio alfanumérico se degrade al de un PIN de 6 cifras, que
   * es lo que pasa cuando todos eligen solo números.
   */
  private assertCodeIsAcceptable(code: string): void {
    const length = AUTH_CONSTANTS.ACCESS_CODE_LENGTH;

    const weak =
      !new RegExp(`^[A-Z0-9]{${length}}$`).test(code) ||
      !/[A-Z]/.test(code) ||
      !/[0-9]/.test(code) ||
      new RegExp(`^(.)\\1{${length - 1}}$`).test(code) ||   // AAAAAA, 111111…
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.includes(code) ||        // ABCDEF, BCDEFG…
      '0123456789'.includes(code) ||                        // 012345, 123456…
      '9876543210'.includes(code);                          // 654321, 987654…

    if (weak) {
      throw new CustomError({
        message: `La clave debe tener ${length} caracteres, combinar letras y números, y no ser una secuencia obvia`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.ACCESS_CODE_TOO_WEAK,
      });
    }
  }

  private assertAccountNotLocked(user: User): void {
    if (user.accessCodeLockedUntil && new Date() < user.accessCodeLockedUntil) {
      const minutes = Math.ceil((user.accessCodeLockedUntil.getTime() - Date.now()) / 60_000);
      throw new CustomError({
        message: `Cuenta bloqueada por intentos fallidos. Intenta en ${minutes} minuto(s)`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.ACCESS_CODE_LOCKED,
      });
    }
  }

  /**
   * Cuenta el fallo y decide el castigo. Siempre termina lanzando: nunca
   * devuelve el control al caller tras una clave incorrecta.
   *
   * A diferencia del esquema anterior, agotar los intentos NO desvincula el
   * dispositivo: el bloqueo es de la cuenta, y desvincular por fallos permitiría
   * a un tercero dejar sin acceso rápido al residente solo tecleando mal.
   */
  private async registerFailedAttempt(user: User): Promise<never> {
    const attempts = (user.accessCodeFailedAttempts ?? 0) + 1;

    if (attempts < AUTH_CONSTANTS.MAX_ACCESS_CODE_ATTEMPTS) {
      await this.userRepo.update(user.id, { accessCodeFailedAttempts: attempts });
      const remaining = AUTH_CONSTANTS.MAX_ACCESS_CODE_ATTEMPTS - attempts;
      throw new CustomError({
        message: `Clave incorrecta. Te quedan ${remaining} intento(s)`,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.ACCESS_CODE_INVALID,
      });
    }

    await this.userRepo.update(user.id, {
      accessCodeFailedAttempts: 0,
      accessCodeLockedUntil: new Date(Date.now() + AUTH_CONSTANTS.ACCESS_CODE_LOCK_DURATION * 1_000),
    });

    this.logger.warn(`Cuenta bloqueada por intentos de clave — userId: ${user.id}`);

    throw new CustomError({
      message: `Cuenta bloqueada por ${AUTH_CONSTANTS.ACCESS_CODE_LOCK_DURATION / 60} minutos por intentos fallidos`,
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      errorCode: AuthErrorCode.ACCESS_CODE_LOCKED,
    });
  }

  /** Descarta el dispositivo vinculado más antiguo cuando se supera el límite. */
  private async enforceDeviceLimit(userId: string): Promise<void> {
    const active = await this.deviceRepo.find({
      where: { userId, isRevoked: false },
      order: { lastUsedAt: 'ASC', createdAt: 'ASC' },
    });

    const excess = active.length - (AUTH_CONSTANTS.MAX_DEVICES_PER_RESIDENT - 1);
    if (excess <= 0) return;

    for (const device of active.slice(0, excess)) {
      await this.deviceRepo.update(device.id, {
        isRevoked: true,
        revokedReason: 'device_limit_reached',
      });
      if (device.sessionId) {
        await this.tokenService.revokeSession(device.sessionId, 'device_limit_reached');
      }
    }

    this.logger.log(`Límite de dispositivos alcanzado — userId: ${userId} | revocados: ${excess}`);
  }

  /**
   * Carga el usuario con roles y permisos (los necesita el access token) y
   * exige que sea residente: este flujo no se abre a roles administrativos,
   * que tienen contraseña propia.
   */
  private async findResident(userId: string): Promise<User> {
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

    const isResident = (user.userRoles ?? []).some(ur => ur.role?.name === ValidRoles.RESIDENT_ROL);
    if (!isResident) {
      throw new CustomError({
        message: 'La clave de acceso es exclusiva para residentes',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: AuthErrorCode.ACCESS_CODE_NOT_ALLOWED,
      });
    }

    return user;
  }

  /**
   * Un dispositivo vinculado no puede saltarse el estado de la cuenta: si al
   * residente lo suspendieron o le bloquearon el acceso, la clave no sirve.
   */
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

  private maskDeviceId(deviceId: string): string {
    return deviceId.length <= 6 ? '***' : `${deviceId.slice(0, 4)}***${deviceId.slice(-2)}`;
  }
}
