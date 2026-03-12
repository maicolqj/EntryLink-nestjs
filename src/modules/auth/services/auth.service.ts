import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

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
import { DeviceInfo, TokenPair } from '../interfaces/jwt-payload.interface';

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
    try {
      const payload = await this.tokenService.verifyAccessToken(accessToken);
      const expiresAt = payload.exp ? new Date(payload.exp * 1_000) : new Date();

      await Promise.all([
        this.tokenService.blacklistAccessToken(accessToken, expiresAt),
        this.tokenService.revokeSession(sessionId, 'logout'),
        this.sessionService.terminateSession(sessionId),
        this.tokenService.clearUserTokenVersionCache(userId),
      ]);

      return true;
    } catch {
      return false;
    }
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
