import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { OtpService } from './otp.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { LoginEmailInput } from '../dto/inputs/login-email.input';
import { RequestOtpInput } from '../dto/inputs/request-otp.input';
import { VerifyOtpInput } from '../dto/inputs/verify-otp.input';
import { AuthResponse, OtpRequestResponse } from '../dto/responses/auth-response';
import { QrLoginTokenResponse } from '../dto/responses/qr-login-token.response';
import { SetPasswordResponse } from '../dto/responses/set-password.response';
import { DeviceInfo, TokenPair } from '../interfaces/jwt-payload.interface';
import { MailService } from '../../../mail/mail.service';
import { RequestPasswordResetResponse } from '../dto/responses/request-password-reset.response';

/** Roles que pueden iniciar sesión con email + contraseña */
const EMAIL_LOGIN_ROLES: ValidRoles[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
  ValidRoles.COMPLEX_ROL,
];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly otpService: OtpService,
    private readonly cacheService: CacheService,
    private readonly mailService: MailService,
  ) {}

  // ── Login con Email + Contraseña ────────────────────────────────────────

  /**
   * Autenticación para SUPER_ADMIN, COMPLIANCE_OFFICER y COMPLEX_ROL.
   * Valida email, contraseña y que el rol permita este método de login.
   */
  async loginWithEmail(
    input: LoginEmailInput,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const { email, password, rememberMe } = input;

    this.logger.debug(`input recibido ${JSON.stringify(input, null, 5)}`)
    // Verificar bloqueo por IP
    await this.checkIpRateLimit(deviceInfo.ip);

    // Buscar usuario con password seleccionado explícitamente
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
      .andWhere('user.deleted_at IS NULL')
      .andWhere('user.status = :status', {status: UserStatus.ACTIVE})
      .getOne();

      this.logger.debug(`input recibido ${JSON.stringify(user, null, 5)}`);

    if (!user) {
      await this.registerFailedAttempt(email, deviceInfo.ip);
      throw new UnauthorizedException('Credenciales inválidas'); 
    }

    // Verificar que el rol permita login por email
    const userRoleNames = (user.userRoles ?? []).map(ur => ur.role?.name as ValidRoles);
    const canLoginWithEmail = userRoleNames.some(r => EMAIL_LOGIN_ROLES.includes(r));

    if (!canLoginWithEmail) {
      throw new UnauthorizedException(
        'Este tipo de usuario no puede iniciar sesión con email y contraseña',
      );
    }

    // Verificar estado de la cuenta
    this.assertAccountActive(user);
    this.logger.debug(`CONTRASEÑA EN LA BD ${user.password}`)
    // Verificar contraseña
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(email, deviceInfo.ip);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Login exitoso — limpiar intentos fallidos
    await this.clearFailedAttempts(email);

    // Marcar contraseña como establecida (best-effort, por si no estaba marcada aún)
    if (!user.passwordSet) {
      await this.userRepo.update(user.id, { passwordSet: true });
    }

    return this.createSession(user, deviceInfo, rememberMe ?? false);
  }

  // ── OTP: Solicitar código ───────────────────────────────────────────────

  /**
   * Genera y envía un OTP al número de celular del residente.
   * Retorna un mensaje genérico (no expone si el número existe o no).
   */
  async requestOtp(
    input: RequestOtpInput,
    ip: string,
  ): Promise<OtpRequestResponse> {
    const { phoneNumber } = input;

    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .where('user.phone_number = :phoneNumber', { phoneNumber })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    // Respuesta genérica para no revelar si el número existe
    const genericMessage =
      'Si el número está registrado, recibirás un código en tu celular en los próximos segundos';

    if (!user) {
      this.logger.warn(`Solicitud OTP para número no registrado: ${phoneNumber}`);
      return { success: true, message: genericMessage };
    }

    // Verificar que sea un residente
    const isResident = (user.userRoles ?? []).some(
      ur => ur.role?.name === ValidRoles.RESIDENT_ROL,
    );

    if (!isResident) {
      this.logger.warn(`Intento de login por OTP para usuario no-residente: ${user.id}`);
      return { success: true, message: genericMessage };
    }

    this.assertAccountActive(user);

    await this.otpService.generateAndSend(user.id, phoneNumber, ip);

    // En entornos no-producción, exponer el código en la respuesta para testing
    if (process.env.NODE_ENV !== 'production') {
      const otp = await this.userRepo.manager.query(
        `SELECT code FROM otp_codes WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );
      return {
        success: true,
        message: genericMessage,
        debugCode: otp[0]?.code,
      };
    }

    return { success: true, message: genericMessage };
  }

  // ── OTP: Verificar código ───────────────────────────────────────────────

  /**
   * Valida el OTP y emite tokens JWT al residente.
   */
  async verifyOtp(
    input: VerifyOtpInput,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const { phoneNumber, code } = input;

    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('user.phone_number = :phoneNumber', { phoneNumber })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Número de celular no registrado');
    }

    this.assertAccountActive(user);

    // Lanza excepción si el OTP es inválido/expirado
    await this.otpService.validate(phoneNumber, code);

    return this.createSession(user, deviceInfo, false);
  }

  // ── QR Login: Generar token ─────────────────────────────────────────────

  /**
   * Genera un token UUID de un solo uso válido por 72 horas para login por QR.
   * Solo accesible por SUPER_ADMIN.
   */
  async generateQrLoginToken(userId: string): Promise<QrLoginTokenResponse> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID "${userId}" no encontrado`);
    }

    this.assertAccountActive(user);

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000);

    await this.userRepo.update(userId, {
      qrLoginToken: token,
      qrLoginTokenExp: expiresAt,
      qrLoginTokenUsed: false,
    });

    this.logger.log(`QR login token generado para usuario ${userId}`);
    return { token, expiresAt };
  }

  // ── QR Login: Canjear token ─────────────────────────────────────────────

  /**
   * Canjea el token QR de un solo uso y abre una sesión autenticada.
   * No requiere autenticación previa.
   */
  async redeemQrToken(token: string, pin: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.qrLoginToken')
      .addSelect('user.qrLoginTokenExp')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('user.qr_login_token = :token', { token })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      throw new NotFoundException('Token QR no válido');
    }

    if (user.qrLoginTokenUsed) {
      throw new UnauthorizedException('Este token QR ya fue utilizado');
    }

    if (!user.qrLoginTokenExp || new Date() > user.qrLoginTokenExp) {
      throw new UnauthorizedException('El token QR ha expirado');
    }

    // Validar PIN (últimos 4 dígitos del documento de identidad)
    if (!user.identity) {
      throw new BadRequestException('El usuario no tiene documento de identidad registrado');
    }

    const expectedPin = user.identity.slice(-4);
    if (pin !== expectedPin) {
      this.logger.warn(`PIN incorrecto al canjear QR — userId: ${user.id}`);
      throw new UnauthorizedException('PIN incorrecto');
    }

    // Invalidar el token antes de crear la sesión
    await this.userRepo.update(user.id, {
      qrLoginTokenUsed: true,
      qrLoginToken: null,
    });

    this.logger.log(`QR token canjeado — userId: ${user.id}`);
    return this.createSession(user, deviceInfo, false);
  }

  // ── Establecer contraseña inicial ──────────────────────────────────────

  /**
   * Permite al usuario autenticado establecer su contraseña por primera vez
   * (flujo post-login por QR). No requiere contraseña anterior.
   */
  async setInitialPassword(userId: string, newPassword: string): Promise<SetPasswordResponse> {
    const hashedPassword = await bcrypt.hash(newPassword, Number(process.env.HASHSALT) || 10);

    await this.userRepo.update(userId, {
      password: hashedPassword,
      lastPasswordChange: new Date(),
      status: UserStatus.ACTIVE,
      passwordSet: true,
      qrLoginToken: null,
      qrLoginTokenExp: null,
      tokenVersion: () => '"tokenVersion" + 1',
    });

    // Invalida el JWT actual del QR para forzar re-login con email+contraseña
    await this.tokenService.clearUserTokenVersionCache(userId);

    this.logger.log(`Contraseña inicial establecida para usuario ${userId}`);
    return { success: true };
  }

  // ── Refresh Token ───────────────────────────────────────────────────────

  async refreshToken(
    currentRefreshToken: string,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const tokenPair = await this.tokenService.rotateRefreshToken(
      currentRefreshToken,
      deviceInfo,
    );
    return this.toAuthResponse(tokenPair);
  }

  // ── Logout ──────────────────────────────────────────────────────────────

  async logout(
    userId: string,
    sessionId: string,
    accessToken: string,
  ): Promise<boolean> {
    // Limpiar sesión y cache siempre, aunque el token ya esté expirado
    await Promise.allSettled([
      this.tokenService.revokeSession(sessionId, 'logout'),
      this.sessionService.terminateSession(sessionId),
      this.tokenService.clearUserTokenVersionCache(userId),
    ]);

    // Blacklist del access token solo si aún es válido (best-effort)
    try {
      const payload = await this.tokenService.verifyAccessToken(accessToken);
      const expiresAt = payload.exp ? new Date(payload.exp * 1_000) : new Date();
      await this.tokenService.blacklistAccessToken(accessToken, expiresAt);
    } catch {
      // Token expirado o inválido — la sesión ya fue terminada arriba
    }

    return true;
  }

  // ── Reset de contraseña por email ───────────────────────────────────────

  /**
   * Genera un token de restablecimiento y lo envía por email.
   * Lanza excepciones descriptivas (los mensajes se muestran directamente al usuario).
   */
  async requestPasswordReset(email: string): Promise<RequestPasswordResetResponse> {
    // 1. Buscar usuario (error explícito — flujo de recuperación, no de login)
    const user = await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      throw new NotFoundException('No encontramos una cuenta con ese correo electrónico.');
    }

    // 2. Verificar que la cuenta esté activa
    const blockedStatuses: UserStatus[] = [UserStatus.SUSPENDED, UserStatus.BANNED];
    if (blockedStatuses.includes(user.status)) {
      throw new BadRequestException(
        'Esta cuenta está suspendida o inactiva. Contacta al administrador.',
      );
    }

    // 3. Verificar que ya tenga contraseña establecida
    if (!user.passwordSet) {
      throw new BadRequestException(
        'Debes establecer tu contraseña por primera vez usando el código QR ' +
        'que te proporcionó el administrador del sistema.',
      );
    }

    // 4. Generar token y enviar email
    const token = uuidv4();
    const expiresAt = new Date(
      Date.now() + AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1_000,
    );

    await this.userRepo.update(user.id, {
      passwordResetToken: token,
      passwordResetTokenExp: expiresAt,
    });

    const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/auth/reset-password?token=${token}`;

    await this.mailService.queuePasswordResetEmail({
      userId: user.id,
      email: user.email,
      name: user.name,
      resetUrl,
      expiresInMinutes: AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES,
    });

    this.logger.log(`Password reset token generado para usuario ${user.id}`);
    return { success: true, message: 'Te enviamos un enlace a tu correo.' };
  }

  /**
   * Valida el token de restablecimiento y actualiza la contraseña.
   */
  async resetPassword(token: string, newPassword: string): Promise<SetPasswordResponse> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordResetToken')
      .addSelect('user.passwordResetTokenExp')
      .where('user.password_reset_token = :token', { token })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      throw new BadRequestException('El enlace de restablecimiento no es válido');
    }

    if (!user.passwordResetTokenExp || new Date() > user.passwordResetTokenExp) {
      throw new BadRequestException('El enlace de restablecimiento ha expirado. Solicita uno nuevo');
    }

    this.assertAccountActive(user);

    const hashedPassword = await bcrypt.hash(newPassword, Number(process.env.HASHSALT) || 10);

    await this.userRepo.update(user.id, {
      password: hashedPassword,
      lastPasswordChange: new Date(),
      passwordSet: true,
      passwordResetToken: null,
      passwordResetTokenExp: null,
      tokenVersion: () => '"tokenVersion" + 1',
    });

    await this.tokenService.clearUserTokenVersionCache(user.id);

    this.logger.log(`Contraseña restablecida para usuario ${user.id}`);
    return { success: true };
  }

  // ── Helpers privados ────────────────────────────────────────────────────

  private async createSession(
    user: User,
    deviceInfo: DeviceInfo,
    rememberMe: boolean,
  ): Promise<AuthResponse> {
    await this.sessionService.enforceSessionLimit(
      user.id,
      AUTH_CONSTANTS.MAX_SESSIONS_PER_USER,
    );

    const tokenPair = await this.tokenService.generateTokenPair(user, deviceInfo, rememberMe);

    await this.sessionService.createOrUpdateSession(user.id, tokenPair.sessionId, deviceInfo);

    this.logger.log(`Sesión creada — userId: ${user.id} | sessionId: ${tokenPair.sessionId}`);

    return this.toAuthResponse(tokenPair);
  }

  private toAuthResponse(pair: TokenPair): AuthResponse {
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresIn: pair.expiresIn,
      sessionId: pair.sessionId,
    };
  }

  private assertAccountActive(user: User): void {
    if (user.deletedAt) {
      throw new UnauthorizedException('La cuenta ha sido eliminada');
    }

    if (user.accountLockedUntil && new Date() < user.accountLockedUntil) {
      const unlockIn = Math.ceil(
        (user.accountLockedUntil.getTime() - Date.now()) / 60_000,
      );
      throw new UnauthorizedException(
        `Cuenta bloqueada temporalmente. Intenta en ${unlockIn} minuto(s)`,
      );
    }

    const blockedStatuses: UserStatus[] = [
      UserStatus.SUSPENDED,
      UserStatus.BANNED,
    ];

    if (blockedStatuses.includes(user.status)) {
      throw new UnauthorizedException('Tu cuenta está suspendida. Contacta al administrador');
    }
  }

  // ── Rate limiting por intentos fallidos ────────────────────────────────

  private async registerFailedAttempt(identifier: string, ip: string): Promise<void> {
    const key = {
      prefix: AUTH_CONSTANTS.CACHE_PREFIX.FAILED_ATTEMPTS,
      key: identifier,
    };
    const current = await this.cacheService.get<{ count: number; lockedUntil?: string }>({ key });
    const newCount = (current?.count ?? 0) + 1;

    if (newCount >= AUTH_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
      // Bloquear la cuenta temporalmente en la base de datos
      await this.userRepo.update(
        { email: identifier },
        { accountLockedUntil: new Date(Date.now() + AUTH_CONSTANTS.LOGIN_BLOCK_DURATION * 1_000) },
      );
    }

    await this.cacheService.set({
      key,
      data: { count: newCount },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.FAILED_ATTEMPTS },
    });
  }

  private async clearFailedAttempts(identifier: string): Promise<void> {
    await this.cacheService.delete({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.FAILED_ATTEMPTS, key: identifier },
    });
  }

  private async checkIpRateLimit(ip: string): Promise<void> {
    const key = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.IP_RATE_LIMIT, key: ip };
    const data = await this.cacheService.get<{ count: number }>({ key });

    if ((data?.count ?? 0) >= AUTH_CONSTANTS.MAX_IP_ATTEMPTS) {
      throw new UnauthorizedException('Demasiados intentos desde tu dirección IP. Intenta más tarde');
    }

    await this.cacheService.set({
      key,
      data: { count: (data?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.FAILED_ATTEMPTS },
    });
  }
}
