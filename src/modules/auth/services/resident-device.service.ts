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
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { AuthResponse } from '../dto/responses/auth-response';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode, UserErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Login de residentes por dispositivo vinculado + PIN.
 *
 * Motivación: cada login por WhatsApp cuesta un mensaje de plantilla en Meta.
 * Con este flujo el canal pago se usa UNA vez (al vincular) y los inicios de
 * sesión posteriores no generan ningún envío.
 *
 * Modelo de seguridad — el PIN nunca es credencial suficiente por sí solo:
 *   1. `deviceId` (header x-device-id) identifica el equipo.
 *   2. `deviceFingerprint` (HMAC con llave del servidor) ata ese equipo al
 *      user-agent con el que se vinculó; no es falsificable desde el cliente.
 *   3. El PIN se valida SIEMPRE en el servidor contra bcrypt. El cliente puede
 *      usar biometría del SO para desbloquearlo localmente, pero eso nunca
 *      reemplaza esta verificación.
 *   4. Bloqueo temporal por intentos y revocación definitiva por reincidencia:
 *      un PIN de 6 dígitos solo es seguro si no se puede fuerza-brutear.
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
  ) {}

  // ── Vinculación ───────────────────────────────────────────────────────────

  /**
   * Vincula el dispositivo actual al residente autenticado y fija su PIN.
   * Se invoca DESPUÉS de un login válido por documento + systemCode, así que
   * la posesión del dispositivo ya está probada por la sesión en curso.
   */
  async setDevicePin(
    userId: string,
    pin: string,
    deviceInfo: DeviceInfo,
    label?: string,
  ): Promise<ResidentDevice> {
    const deviceId = this.requireDeviceId(deviceInfo);
    const user = await this.findResident(userId);

    this.assertPinIsAcceptable(pin);

    const pinHash = await bcrypt.hash(pin, AUTH_CONSTANTS.DEVICE_PIN_BCRYPT_ROUNDS);

    const existing = await this.deviceRepo.findOne({ where: { userId: user.id, deviceId } });

    if (existing) {
      // Re-vincular limpia el estado punitivo: quien llega aquí ya probó su
      // identidad con una sesión válida, no tiene sentido dejarlo bloqueado.
      await this.deviceRepo.update(existing.id, {
        pinHash,
        deviceFingerprint: deviceInfo.fingerprint,
        platform: deviceInfo.platform,
        label: label ?? existing.label,
        failedAttempts: 0,
        lockedUntil: null,
        isRevoked: false,
        revokedReason: null,
      });
      this.logger.log(`PIN actualizado — userId: ${user.id} | deviceId: ${this.maskDeviceId(deviceId)}`);
      return this.deviceRepo.findOne({ where: { id: existing.id } });
    }

    await this.enforceDeviceLimit(user.id);

    const device = await this.deviceRepo.save(
      this.deviceRepo.create({
        userId: user.id,
        deviceId,
        deviceFingerprint: deviceInfo.fingerprint,
        pinHash,
        platform: deviceInfo.platform,
        label,
      }),
    );

    this.logger.log(`Dispositivo vinculado — userId: ${user.id} | deviceId: ${this.maskDeviceId(deviceId)}`);
    return device;
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  /**
   * Inicia sesión con el PIN del dispositivo vinculado. Cero mensajes salientes.
   *
   * Los errores de "dispositivo no vinculado" y "PIN incorrecto" son
   * deliberadamente distintos: el atacante ya necesita el deviceId exacto para
   * llegar hasta aquí, y el residente necesita saber si debe re-vincular.
   */
  async loginWithDevicePin(pin: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const deviceId = this.requireDeviceId(deviceInfo);

    const device = await this.deviceRepo
      .createQueryBuilder('device')
      .addSelect('device.pinHash')
      .where('device.device_id = :deviceId', { deviceId })
      .andWhere('device.is_revoked = false')
      .getOne();

    if (!device) {
      throw new CustomError({
        message: 'Este dispositivo no está vinculado. Inicia sesión con tu documento y código',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.DEVICE_NOT_LINKED,
      });
    }

    // Mismo deviceId pero otro navegador/app: el vínculo no aplica.
    if (device.deviceFingerprint !== deviceInfo.fingerprint) {
      this.logger.warn(`Fingerprint no coincide en login por PIN — deviceId: ${this.maskDeviceId(deviceId)}`);
      throw new CustomError({
        message: 'Este dispositivo no está vinculado. Inicia sesión con tu documento y código',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.DEVICE_NOT_LINKED,
      });
    }

    this.assertDeviceNotLocked(device);

    const isValid = await bcrypt.compare(pin, device.pinHash);
    if (!isValid) {
      await this.registerFailedPinAttempt(device);
    }

    const user = await this.findResident(device.userId);
    this.assertUserActive(user);

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

    await this.deviceRepo.update(device.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastUsedAt: new Date(),
      sessionId: tokenPair.sessionId,
    });

    this.logger.log(`Login por PIN de dispositivo — userId: ${user.id} | sessionId: ${tokenPair.sessionId}`);

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

  /**
   * Rechaza los PIN que un atacante probaría primero. Con 6 dígitos el espacio
   * es de un millón de combinaciones; descartar los patrones obvios es lo que
   * mantiene útil ese espacio.
   */
  private assertPinIsAcceptable(pin: string): void {
    const weak =
      !/^\d{6}$/.test(pin) ||
      /^(\d)\1{5}$/.test(pin) ||                 // 000000, 111111…
      '0123456789'.includes(pin) ||              // 012345, 123456…
      '9876543210'.includes(pin) ||              // 654321, 987654…
      /^(\d{2})\1{2}$/.test(pin) ||              // 121212, 454545…
      /^(\d{3})\1$/.test(pin);                   // 123123, 789789…

    if (weak) {
      throw new CustomError({
        message: 'El PIN debe tener 6 dígitos y no puede ser una secuencia o repetición obvia',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.DEVICE_PIN_TOO_WEAK,
      });
    }
  }

  private assertDeviceNotLocked(device: ResidentDevice): void {
    if (device.lockedUntil && new Date() < device.lockedUntil) {
      const minutes = Math.ceil((device.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new CustomError({
        message: `Dispositivo bloqueado por intentos fallidos. Intenta en ${minutes} minuto(s)`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.DEVICE_LOCKED,
      });
    }
  }

  /**
   * Cuenta el fallo y decide el castigo. Siempre termina lanzando: nunca
   * devuelve el control al caller tras un PIN incorrecto.
   */
  private async registerFailedPinAttempt(device: ResidentDevice): Promise<never> {
    const attempts = device.failedAttempts + 1;

    if (attempts < AUTH_CONSTANTS.MAX_DEVICE_PIN_ATTEMPTS) {
      await this.deviceRepo.update(device.id, { failedAttempts: attempts });
      const remaining = AUTH_CONSTANTS.MAX_DEVICE_PIN_ATTEMPTS - attempts;
      throw new CustomError({
        message: `PIN incorrecto. Te quedan ${remaining} intento(s)`,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.DEVICE_PIN_INVALID,
      });
    }

    // Se agotaron los intentos de esta tanda. `failedAttempts` sigue creciendo
    // entre bloqueos para detectar al que insiste: tras MAX_DEVICE_PIN_LOCKOUTS
    // tandas el vínculo se rompe y solo se recupera con documento + systemCode.
    const lockouts = Math.floor(attempts / AUTH_CONSTANTS.MAX_DEVICE_PIN_ATTEMPTS);

    if (lockouts >= AUTH_CONSTANTS.MAX_DEVICE_PIN_LOCKOUTS) {
      await this.deviceRepo.update(device.id, {
        failedAttempts: attempts,
        isRevoked: true,
        revokedReason: 'pin_bruteforce',
      });

      if (device.sessionId) {
        await this.tokenService.revokeSession(device.sessionId, 'pin_bruteforce');
      }

      this.logger.warn(
        `Dispositivo revocado por fuerza bruta de PIN — userId: ${device.userId} | intentos: ${attempts}`,
      );

      throw new CustomError({
        message: 'Dispositivo desvinculado por seguridad. Inicia sesión con tu documento y código',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.DEVICE_REVOKED,
      });
    }

    await this.deviceRepo.update(device.id, {
      failedAttempts: attempts,
      lockedUntil: new Date(Date.now() + AUTH_CONSTANTS.DEVICE_PIN_LOCK_DURATION * 1_000),
    });

    throw new CustomError({
      message: `Dispositivo bloqueado por ${AUTH_CONSTANTS.DEVICE_PIN_LOCK_DURATION / 60} minutos por intentos fallidos`,
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      errorCode: AuthErrorCode.DEVICE_LOCKED,
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
        message: 'El login por PIN de dispositivo es exclusivo para residentes',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: AuthErrorCode.DEVICE_PIN_NOT_ALLOWED,
      });
    }

    return user;
  }

  /**
   * Un dispositivo vinculado no puede saltarse el estado de la cuenta: si al
   * residente lo suspendieron o le bloquearon el acceso, el PIN no sirve.
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
