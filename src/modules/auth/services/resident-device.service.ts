import { Injectable, Logger, HttpStatus } from '@nestjs/common';
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
 * Modelo de seguridad — la clave NUNCA alcanza por sí sola:
 *   1. `deviceId` (header x-device-id) identifica el equipo y, con él, al dueño.
 *      Un equipo desconocido no llega siquiera a comparar la clave.
 *   2. `deviceFingerprint` (HMAC con llave del servidor) ata ese equipo al
 *      user-agent con el que se vinculó; no es falsificable desde el cliente.
 *   3. La clave se valida SIEMPRE contra bcrypt en el servidor. El cliente puede
 *      usar biometría del SO para desbloquearla localmente, pero eso no
 *      reemplaza esta verificación.
 *   4. Bloqueo temporal por intentos fallidos, contados en la CUENTA. Contarlos
 *      por dispositivo permitiría multiplicar los intentos con solo cambiar de
 *      equipo, que es justo lo que el límite intenta impedir.
 *
 * Vincular un equipo nuevo exige pasar antes por WhatsApp entrante o por la
 * aprobación desde un equipo confiable. Entrar en el teléfono de un tercero
 * "solo con usuario y clave" no es posible por diseño.
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
   * Inicia sesión con la clave de la cuenta desde un dispositivo ya vinculado.
   * Cero mensajes salientes.
   *
   * Los errores de "dispositivo no vinculado" y "clave incorrecta" son
   * deliberadamente distintos: el atacante ya necesita el deviceId exacto para
   * llegar hasta aquí, y el residente necesita saber si debe volver a vincular.
   */
  async loginWithAccessCode(code: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const deviceId = this.requireDeviceId(deviceInfo);

    const device = await this.deviceRepo
      .createQueryBuilder('device')
      .where('device.device_id = :deviceId', { deviceId })
      .andWhere('device.is_revoked = false')
      .getOne();

    if (!device || device.deviceFingerprint !== deviceInfo.fingerprint) {
      if (device) {
        this.logger.warn(`Fingerprint no coincide — deviceId: ${this.maskDeviceId(deviceId)}`);
      }
      throw new CustomError({
        message: 'Este dispositivo no está vinculado. Ingresa con WhatsApp o pide aprobación desde otro equipo',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.DEVICE_NOT_LINKED,
      });
    }

    const user = await this.findResident(device.userId);
    this.assertUserActive(user);
    this.assertAccountNotLocked(user);

    const withHash = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.accessCodeHash')
      .where('user.id = :userId', { userId: user.id })
      .getOne();

    if (!withHash?.accessCodeHash) {
      throw new CustomError({
        message: 'Tu cuenta todavía no tiene clave. Ingresa con WhatsApp para crearla',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.ACCESS_CODE_NOT_SET,
      });
    }

    const isValid = await bcrypt.compare(this.normalizeCode(code), withHash.accessCodeHash);
    if (!isValid) await this.registerFailedAttempt(withHash);

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
