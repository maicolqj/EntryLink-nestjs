import {
  Injectable,
  UnauthorizedException,
  Logger,
  NotFoundException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { OtpService } from './otp.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { LoginEmailInput, EMAIL_PASSWORD_USER_ROLES } from '../dto/inputs/login-email.input';
import { LoginSystemCodeInput, SYSTEM_CODE_ROLES } from '../dto/inputs/login-system-code.input';
import { RequestOtpInput } from '../dto/inputs/request-otp.input';
import { VerifyOtpInput } from '../dto/inputs/verify-otp.input';
import { AuthResponse, OtpRequestResponse } from '../dto/responses/auth-response';
import { DeviceInfo, TokenPair } from '../interfaces/jwt-payload.interface';
import { QrLoginTokenResponse } from '../dto/responses/qr-login-token.response';
import { SetPasswordResponse } from '../dto/responses/set-password.response';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { Role } from '../../roles/entities/role.entity';
import { RegisterSupervisorInput } from '../dto/inputs/register-supervisor.input';
import { UserErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { CustomError } from '../../shared/utils/errors.utils';
import { ResetPasswordInput } from '../dto/inputs/reset-password.input';
import { RequestPasswordResetResponse } from '../dto/responses/request-password-reset.response';
import { RegisterSupervisorResponse } from '../dto/responses/register-supervisor.response';
import { MailService } from '../../../mail/mail.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly otpService: OtpService,
    private readonly cacheService: CacheService,
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // LOGIN A: Email + Contraseña
  //   - COMPLEX_ROL      → credenciales de residential_complexes
  //   - SUPER_ADMIN_ROL  → credenciales de users
  //   - ACCOUNTANT_ROL   → credenciales de users
  //   - COMPILANCE_OFFICER_ROL → credenciales de users
  // ═══════════════════════════════════════════════════════════════

  async loginWithEmail(
    input: LoginEmailInput,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    await this.checkIpRateLimit(deviceInfo.ip);

    // Paso 1: buscar en users (SUPER_ADMIN, COMPLIANCE_OFFICER, ACCOUNTANT)
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(user.email) = LOWER(:email)', { email: input.email.trim() })
      .andWhere('user.deleted_at IS NULL')
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .getOne();

    if (user) {
      const userRoleNames = (user.userRoles ?? []).map(ur => ur.role?.name as ValidRoles);
      const hasValidRole = userRoleNames.some(r =>
        (EMAIL_PASSWORD_USER_ROLES as readonly ValidRoles[]).includes(r),
      );

      if (!hasValidRole) {
        throw new UnauthorizedException('Este usuario no puede iniciar sesión con email y contraseña');
      }

      return this.loginUser(input, user, deviceInfo);
    }

    // Paso 2: buscar en residential_complexes (COMPLEX_ROL)
    return this.loginComplex(input, deviceInfo);
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGIN B: Email + numero de identidad
  //   - SUPERVISOR_ROL → users
  //   - SECURITY_ROL   → users
  //   - RESIDENT_ROL   → users
  // ═══════════════════════════════════════════════════════════════

  async loginWithIdentity(
    input: LoginSystemCodeInput,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const { identity, password } = input;

    await this.checkIpRateLimit(deviceInfo.ip);

    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .addSelect('user.identity')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(user.identity) = LOWER(:identity)', { identity: identity.trim() })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      await this.registerFailedAttempt(identity, deviceInfo.ip);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // VULN-14 fix: verificar password ANTES de revelar estado de cuenta para evitar user enumeration
    // Un atacante no puede distinguir "usuario suspendido" de "password incorrecto"
    const passwordValid = user.password && await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(identity, deviceInfo.ip, true, user.email);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const userRoleNames = (user.userRoles ?? []).map(ur => ur.role?.name as ValidRoles);
    const hasValidRole = userRoleNames.some(r =>
      (SYSTEM_CODE_ROLES as readonly ValidRoles[]).includes(r),
    );

    if (!hasValidRole) {
      // Password era correcto pero el rol no aplica — mensaje genérico para no revelar info
      throw new UnauthorizedException('Credenciales inválidas');
    }

    this.assertUserAccountActive(user);

    await this.clearFailedAttempts(identity);
    this.logger.log(`Login exitoso (identity): userId=${user.id}`);
    return this.createUserSession(user, deviceInfo, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGIN C: Teléfono + OTP (RESIDENT_ROL)
  // ═══════════════════════════════════════════════════════════════

  async requestOtp(input: RequestOtpInput, ip: string): Promise<OtpRequestResponse> {
    const { phoneNumber } = input;

    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .where('user.phone_number = :phoneNumber', { phoneNumber })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    const genericMessage = 'Si el número está registrado, recibirás un código en los próximos segundos';

    if (!user) {
      this.logger.warn(`OTP para número no registrado: ${phoneNumber}`);
      return { success: true, message: genericMessage };
    }

    const isResident = (user.userRoles ?? []).some(ur => ur.role?.name === ValidRoles.RESIDENT_ROL);
    if (!isResident) {
      this.logger.warn(`OTP para usuario no-residente: ${user.id}`);
      return { success: true, message: genericMessage };
    }

    this.assertUserAccountActive(user);
    await this.otpService.generateAndSend(user.id, phoneNumber, ip);

    return { success: true, message: genericMessage };
  }

  async verifyOtp(input: VerifyOtpInput, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const { phoneNumber, code } = input;

    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('user.phone_number = :phoneNumber', { phoneNumber })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) throw new UnauthorizedException('Número de celular no registrado');

    this.assertUserAccountActive(user);
    await this.otpService.validate(phoneNumber, code);

    return this.createUserSession(user, deviceInfo, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // QR Login: generar token (SUPER_ADMIN genera para un complejo)
  // ═══════════════════════════════════════════════════════════════

  async generateQrLoginToken(complexId: string): Promise<QrLoginTokenResponse> {
    const complex = await this.complexRepo.findOne({ where: { id: complexId } });

    if (!complex) {
      throw new NotFoundException(`Complejo con ID "${complexId}" no encontrado`);
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000);

    // VULN-02 fix: PIN aleatorio criptográficamente seguro — el NIT es dato público/predecible
    const { randomInt } = await import('crypto');
    const rawPin = String(randomInt(100_000, 1_000_000)); // 6 dígitos, espacio 900k
    const hashedPin = await bcrypt.hash(rawPin, 12);

    await this.complexRepo.update(complexId, {
      qrLoginToken: token,
      qrLoginTokenExp: expiresAt,
      qrLoginTokenUsed: false,
      qrLoginPin: hashedPin,
    });

    this.logger.log(`QR login token generado para complejo ${complexId}`);
    return { token, expiresAt, pin: rawPin };
  }

  // ═══════════════════════════════════════════════════════════════
  // QR Login: canjear token (el complejo escanea el QR)
  // ═══════════════════════════════════════════════════════════════

  async redeemQrToken(token: string, pin: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const complex = await this.complexRepo
      .createQueryBuilder('complex')
      .addSelect('complex.qrLoginToken')
      .addSelect('complex.qrLoginTokenExp')
      .addSelect('complex.qrLoginPin')
      .leftJoinAndSelect('complex.owner', 'owner')
      .leftJoinAndSelect('owner.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('complex.qrLoginToken = :token', { token })
      .andWhere('complex.deleted_at IS NULL')
      .getOne();

    if (!complex) {
      throw new NotFoundException('Token QR no válido');
    }

    if (complex.qrLoginTokenUsed) {
      throw new UnauthorizedException('Este token QR ya fue utilizado');
    }

    if (!complex.qrLoginTokenExp || new Date() > complex.qrLoginTokenExp) {
      throw new UnauthorizedException('El token QR ha expirado');
    }

    if (!complex.qrLoginPin) {
      throw new BadRequestException('PIN no configurado para este token QR');
    }

    const pinValid = await bcrypt.compare(pin, complex.qrLoginPin);
    if (!pinValid) {
      this.logger.warn(`PIN incorrecto al canjear QR — complexId: ${complex.id}`);
      throw new UnauthorizedException('PIN incorrecto');
    }

    // Marcar como usado antes de crear la sesión (one-time use).
    // qrLoginToken se conserva para que "ya fue utilizado" pueda disparar si se reintenta;
    // se limpia definitivamente en setInitialPassword.
    await this.complexRepo.update(complex.id, {
      qrLoginTokenUsed: true,
      qrLoginPin: null as unknown as string,
    });

    this.assertComplexAccountActive(complex);

    if (!complex.owner) {
      throw new NotFoundException('No se encontró el propietario del complejo');
    }

    this.assertUserAccountActive(complex.owner);

    this.logger.log(`QR token canjeado — complexId: ${complex.id} | owner: ${complex.ownerId}`);
    return this.createComplexSession(complex, deviceInfo, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // Establecer contraseña inicial del complejo (post-QR login)
  // ═══════════════════════════════════════════════════════════════

  async setInitialPassword(complexId: string, newPassword: string): Promise<SetPasswordResponse> {
    // VULN-07 fix: usar ConfigService en lugar de process.env directo
    const saltRounds = this.configService.get<number>('BCRYPT_ROUNDS', 12);
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await this.complexRepo.update(complexId, {
      password: hashedPassword,
      lastPasswordChange: new Date(),
      passwordSet: true,
      qrLoginToken: null as unknown as string,
      qrLoginTokenExp: null as unknown as Date,
      qrLoginPin: null as unknown as string,
      tokenVersion: () => '"tokenVersion" + 1',
    });

    await this.tokenService.clearUserTokenVersionCache(complexId);

    this.logger.log(`Contraseña inicial establecida para complejo ${complexId}`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // Refresh Token
  // ═══════════════════════════════════════════════════════════════

  async refreshToken(currentRefreshToken: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const tokenPair = await this.tokenService.rotateRefreshToken(currentRefreshToken, deviceInfo);
    return this.toAuthResponse(tokenPair);
  }

  // ═══════════════════════════════════════════════════════════════
  // Logout
  // ═══════════════════════════════════════════════════════════════

  async logout(userId: string, sessionId: string, accessToken: string): Promise<boolean> {
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

  // ═══════════════════════════════════════════════════════════════
  // REGISTRO PÚBLICO: Supervisor se auto-registra en la plataforma
  // ═══════════════════════════════════════════════════════════════

  async registerSupervisor(
    input: RegisterSupervisorInput,
  ): Promise<RegisterSupervisorResponse> {
    // 1. Verificar email no en uso (incluyendo cuentas pendientes)
    const existing = await this.userRepo.findOne({
      where: { email: input.email.toLowerCase().trim() },
    });
    if (existing) {
      // Respuesta genérica para no revelar si el email existe
      return {
        success: true,
        supervisorId: null,
        message: 'Si el correo es válido, recibirás un enlace de verificación en los próximos minutos.',
      };
    }

    // 2. Obtener rol SUPERVISOR_ROL
    const supervisorRole = await this.roleRepo.findOne({
      where: { name: ValidRoles.SUPERVISOR_ROL },
    });
    if (!supervisorRole) {
      throw new CustomError({
        message: 'Rol SUPERVISOR_ROL no encontrado en la base de datos',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    // 3. Crear usuario con PENDING_VERIFICATION — sin emitir JWT
    const [firstName, ...rest] = input.fullName.trim().split(' ');
    const lastName = rest.join(' ') || firstName;
    const verificationToken = uuidv4();
    const tokenExp = new Date(
      Date.now() + AUTH_CONSTANTS.EMAIL_VERIFICATION_EXPIRY_MINUTES * 60_000,
    );

    const user = await this.dataSource.transaction(async (manager) => {
      const newUser = manager.create(User, {
        name:                  firstName,
        lastName:              lastName,
        email:                 input.email,
        password:              input.password,   // BeforeInsert hashea automáticamente
        phoneNumber:           input.phone,
        identity:              input.documentNumber,
        status:                UserStatus.PENDING_VERIFICATION,
        passwordSet:           true,
        phoneVerified:         false,
        emailVerified:         false,
        identityVerified:      false,
        passwordResetToken:    verificationToken,
        passwordResetTokenExp: tokenExp,
      });

      const savedUser = await manager.save(User, newUser);

      await manager.save(
        manager.create(UserRole, {
          user: { id: savedUser.id },
          role: { id: supervisorRole.id },
          isPrimary: true,
        }),
      );

      return savedUser;
    });

    // 4. Enviar email de verificación (fire-and-forget)
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

    void this.mailService.queueEmailVerificationEmail({
      userId:          user.id,
      email:           user.email,
      name:            user.name,
      verificationUrl,
      expiresInMinutes: AUTH_CONSTANTS.EMAIL_VERIFICATION_EXPIRY_MINUTES,
    });

    this.logger.log(`Supervisor registrado (pendiente de verificación): userId=${user.id}`);

    return {
      success: true,
      supervisorId: user.id,
      message: 'Si el correo es válido, recibirás un enlace de verificación en los próximos minutos.',
    };
  }

  async verifySupervisorEmail(
    token: string,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    // 1. Buscar usuario por token de verificación
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordResetToken')
      .addSelect('user.passwordResetTokenExp')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('user.passwordResetToken = :token', { token })
      .andWhere('user.status = :status', { status: UserStatus.PENDING_VERIFICATION })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      throw new CustomError({
        message: 'El enlace de verificación no es válido o ya fue utilizado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    // 2. Verificar que el token no haya expirado
    if (!user.passwordResetTokenExp || new Date() > user.passwordResetTokenExp) {
      throw new CustomError({
        message: 'El enlace de verificación ha expirado. Por favor regístrate nuevamente',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    // 3. Activar cuenta y limpiar token
    await this.userRepo.update(user.id, {
      status:                UserStatus.ACTIVE,
      emailVerified:         true,
      passwordResetToken:    null,
      passwordResetTokenExp: null,
    });

    user.status        = UserStatus.ACTIVE;
    user.emailVerified = true;

    this.logger.log(`Email verificado — supervisor activado: userId=${user.id}`);

    // 4. Emitir sesión JWT
    return this.createUserSession(user, deviceInfo, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // Reset de contraseña por email
  // ═══════════════════════════════════════════════════════════════

  async requestPasswordReset(email: string): Promise<RequestPasswordResetResponse> {
    const genericResponse: RequestPasswordResetResponse = {
      success: true,
      message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
    };

    const normalizedEmail = email.toLowerCase().trim();
    const rateLimitKey = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.PASSWORD_RESET_RATE_LIMIT, key: normalizedEmail };

    const rateData = await this.cacheService.get<{ count: number }>({ key: rateLimitKey });
    if ((rateData?.count ?? 0) >= AUTH_CONSTANTS.PASSWORD_RESET_RATE_LIMIT_MAX) {
      return genericResponse;
    }

    // Buscar primero en usuarios (SUPER_ADMIN, COMPILANCE, ACCOUNTANT, SUPERVISOR)
    const user = await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: normalizedEmail })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (user) {
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES * 60_000);

      await this.userRepo.update(user.id, {
        passwordResetToken: token,
        passwordResetTokenExp: expiresAt,
      });

      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
      const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

      await this.mailService.queuePasswordResetEmail({
        userId: user.id,
        email: user.email,
        name: user.name,
        resetUrl,
        expiresInMinutes: AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES,
      });

      await this.cacheService.set({
        key: rateLimitKey,
        data: { count: (rateData?.count ?? 0) + 1 },
        options: { ttl: AUTH_CONSTANTS.CACHE_TTL.PASSWORD_RESET_RATE_LIMIT },
      });

      this.logger.log(`Password reset solicitado — userId: ${user.id}`);
      return genericResponse;
    }

    // Buscar en complejos residenciales (COMPLEX_ROL)
    const complex = await this.complexRepo
      .createQueryBuilder('complex')
      .where('LOWER(complex.email) = LOWER(:email)', { email: normalizedEmail })
      .andWhere('complex.deleted_at IS NULL')
      .getOne();

    // Si el complejo no ha establecido contraseña vía QR, no permitir reset por email
    if (!complex || !complex.passwordSet) {
      return genericResponse;
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES * 60_000);

    await this.complexRepo.update(complex.id, {
      passwordResetToken: token,
      passwordResetTokenExp: expiresAt,
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    await this.mailService.queuePasswordResetEmail({
      userId: complex.id,
      email: complex.email!,
      name: complex.name,
      resetUrl,
      expiresInMinutes: AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES,
    });

    await this.cacheService.set({
      key: rateLimitKey,
      data: { count: (rateData?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.PASSWORD_RESET_RATE_LIMIT },
    });

    this.logger.log(`Password reset solicitado — complexId: ${complex.id}`);
    return genericResponse;
  }

  async resetPassword(input: ResetPasswordInput): Promise<SetPasswordResponse> {
    // Buscar token en usuarios
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordResetToken')
      .addSelect('user.passwordResetTokenExp')
      .where('user.passwordResetToken = :token', { token: input.token })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (user) {
      if (!user.passwordResetTokenExp || new Date() > user.passwordResetTokenExp) {
        await this.userRepo.update(user.id, {
          passwordResetToken: null as unknown as string,
          passwordResetTokenExp: null as unknown as Date,
        });
        throw new BadRequestException({
          message: 'El enlace de restablecimiento ha expirado. Solicita uno nuevo.',
          errorCode: UserErrorCode.TOKEN_EXPIRED,
        });
      }

      const saltRounds = this.configService.get<number>('BCRYPT_ROUNDS', 12);
      const hashedPassword = await bcrypt.hash(input.newPassword, saltRounds);

      await this.userRepo.update(user.id, {
        password: hashedPassword,
        passwordResetToken: null as unknown as string,
        passwordResetTokenExp: null as unknown as Date,
        passwordSet: true,
        lastPasswordChange: new Date(),
        tokenVersion: () => '"tokenVersion" + 1',
      });

      // VULN-15 fix: terminar sesiones activas, consistente con el flujo de complejos
      await Promise.all([
        this.tokenService.revokeAllUserTokens(user.id, 'password_reset'),
        this.tokenService.clearUserTokenVersionCache(user.id),
        this.sessionService.terminateAllUserSessions(user.id),
      ]);

      this.logger.log(`Contraseña restablecida exitosamente — userId: ${user.id}`);
      return { success: true };
    }

    // Buscar token en complejos residenciales
    const complex = await this.complexRepo
      .createQueryBuilder('complex')
      .addSelect('complex.passwordResetToken')
      .addSelect('complex.passwordResetTokenExp')
      .where('complex.passwordResetToken = :token', { token: input.token })
      .andWhere('complex.deleted_at IS NULL')
      .getOne();

    if (!complex) {
      throw new BadRequestException({
        message: 'El enlace de restablecimiento no es válido',
        errorCode: UserErrorCode.INVALID_TOKEN,
      });
    }

    if (!complex.passwordResetTokenExp || new Date() > complex.passwordResetTokenExp) {
      await this.complexRepo.update(complex.id, {
        passwordResetToken: null as unknown as string,
        passwordResetTokenExp: null as unknown as Date,
      });
      throw new BadRequestException({
        message: 'El enlace de restablecimiento ha expirado. Solicita uno nuevo.',
        errorCode: UserErrorCode.TOKEN_EXPIRED,
      });
    }

    const saltRounds = this.configService.get<number>('BCRYPT_ROUNDS', 12);
    const hashedPassword = await bcrypt.hash(input.newPassword, saltRounds);

    await this.complexRepo.update(complex.id, {
      password: hashedPassword,
      passwordResetToken: null as unknown as string,
      passwordResetTokenExp: null as unknown as Date,
      passwordSet: true,
      lastPasswordChange: new Date(),
      tokenVersion: () => '"tokenVersion" + 1',
    });

    await Promise.all([
      this.tokenService.revokeAllUserTokens(complex.id, 'password_reset'),
      this.tokenService.clearUserTokenVersionCache(complex.id),
      this.sessionService.terminateAllUserSessions(complex.id),
    ]);

    this.logger.log(`Contraseña restablecida exitosamente — complexId: ${complex.id}`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // Métodos privados de autenticación
  // ═══════════════════════════════════════════════════════════════

  /**
   * Valida password del User y crea sesión con entityType='user'.
   * Usado por SUPER_ADMIN_ROL, COMPILANCE_OFFICER_ROL, ACCOUNTANT_ROL.
   */
  private async loginUser(
    input: LoginEmailInput,
    user: User,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    this.assertUserAccountActive(user);

    const passwordValid = await bcrypt.compare(input.password, user.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(input.email, deviceInfo.ip);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.clearFailedAttempts(input.email);
    this.logger.log(`Login exitoso (user email+pwd): userId=${user.id}`);
    return this.createUserSession(user, deviceInfo, input.rememberMe ?? false);
  }

  /**
   * Valida email+password contra residential_complexes y crea sesión con entityType='complex'.
   * Usado exclusivamente por COMPLEX_ROL.
   */
  private async loginComplex(
    input: LoginEmailInput,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const { email, password, rememberMe } = input;

    // Cargar el complejo con su owner (para roles y permisos en el JWT)
    const complex = await this.complexRepo
      .createQueryBuilder('complex')
      .addSelect('complex.password')
      .leftJoinAndSelect('complex.owner', 'owner')
      .leftJoinAndSelect('owner.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(complex.email) = LOWER(:email)', { email: email.trim() })
      .andWhere('complex.deleted_at IS NULL')
      .getOne();

    if (!complex || !complex.password || !complex.passwordSet) {
      await this.registerFailedAttempt(email, deviceInfo.ip, false);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await bcrypt.compare(password, complex.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(email, deviceInfo.ip, false);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    this.assertComplexAccountActive(complex);

    if (!complex.owner) {
      throw new UnauthorizedException('No se encontró el propietario del complejo');
    }

    this.assertUserAccountActive(complex.owner);
    await this.clearFailedAttempts(email);

    this.logger.log(`Login exitoso (complex email+pwd): complexId=${complex.id} owner=${complex.ownerId}`);
    return this.createComplexSession(complex, deviceInfo, rememberMe ?? false);
  }

  // ═══════════════════════════════════════════════════════════════
  // Creación de sesiones
  // ═══════════════════════════════════════════════════════════════

  /**
   * Crea sesión para un User (SUPER_ADMIN, COMPLIANCE, ACCOUNTANT, SUPERVISOR, SECURITY, RESIDENT).
   * sub JWT = user.id | email JWT = user.email | tokenVersion = user.tokenVersion
   */
  private async createUserSession(
    user: User,
    deviceInfo: DeviceInfo,
    rememberMe: boolean,
  ): Promise<AuthResponse> {
    await this.sessionService.enforceSessionLimit(user.id, AUTH_CONSTANTS.MAX_SESSIONS_PER_USER);

    const tokenPair = await this.tokenService.generateTokenPair(user, deviceInfo, rememberMe, 'user');

    await this.sessionService.createOrUpdateSession(user.id, tokenPair.sessionId, deviceInfo);

    this.logger.log(`Sesión user creada — sub: ${user.id} | sessionId: ${tokenPair.sessionId}`);
    return this.toAuthResponse(tokenPair);
  }

  /**
   * Crea sesión para un ResidentialComplex (COMPLEX_ROL).
   * sub JWT = complex.id | email JWT = complex.email | tokenVersion = complex.tokenVersion
   * La FK de UserSession apunta a complex.ownerId (constraint válida hacia users).
   */
  private async createComplexSession(
    complex: ResidentialComplex,
    deviceInfo: DeviceInfo,
    rememberMe: boolean,
  ): Promise<AuthResponse> {
    await this.sessionService.enforceSessionLimit(complex.ownerId, AUTH_CONSTANTS.MAX_SESSIONS_PER_USER);

    const tokenPair = await this.tokenService.generateTokenPairForComplex(complex, deviceInfo, rememberMe);

    await this.sessionService.createOrUpdateSession(complex.ownerId, tokenPair.sessionId, deviceInfo);

    this.logger.log(`Sesión complex creada — sub: ${complex.id} | owner: ${complex.ownerId} | sessionId: ${tokenPair.sessionId}`);
    return this.toAuthResponse(tokenPair);
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers privados
  // ═══════════════════════════════════════════════════════════════

  private toAuthResponse(pair: TokenPair): AuthResponse {
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresIn: pair.expiresIn,
      sessionId: pair.sessionId,
    };
  }

  /** Valida que el complejo esté activo. Bloquea INACTIVE y SUSPENDED. */
  private assertComplexAccountActive(complex: ResidentialComplex): void {
    if (complex.status === ComplexStatus.INACTIVE) {
      throw new UnauthorizedException('El complejo residencial está inactivo. Contacta al administrador');
    }
    if (complex.status === ComplexStatus.SUSPENDED) {
      throw new UnauthorizedException('El complejo residencial está suspendido. Contacta al administrador');
    }
  }

  /** Valida que la cuenta User esté activa (no eliminada, no bloqueada, no suspendida). */
  private assertUserAccountActive(user: User): void {
    if (user.deletedAt) {
      throw new UnauthorizedException('La cuenta ha sido eliminada');
    }

    if (user.accountLockedUntil && new Date() < user.accountLockedUntil) {
      const unlockIn = Math.ceil((user.accountLockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(`Cuenta bloqueada temporalmente. Intenta en ${unlockIn} minuto(s)`);
    }

    const blockedStatuses: UserStatus[] = [
      UserStatus.SUSPENDED,
      UserStatus.BANNED,
      UserStatus.INACTIVE,
      UserStatus.PENDING_VERIFICATION,
    ];
    if (blockedStatuses.includes(user.status)) {
      const isPending = user.status === UserStatus.PENDING_VERIFICATION;
      throw new UnauthorizedException(
        isPending
          ? 'Debes verificar tu correo electrónico antes de iniciar sesión'
          : 'Tu cuenta está suspendida o inactiva. Contacta al administrador',
      );
    }
  }

  // ── Rate limiting ───────────────────────────────────────────────────────

  private async registerFailedAttempt(
    identifier: string,
    ip: string,
    updateUserDb = true,
    userEmail?: string,
  ): Promise<void> {
    const key = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.FAILED_ATTEMPTS, key: identifier };
    const current = await this.cacheService.get<{ count: number }>({ key });
    const newCount = (current?.count ?? 0) + 1;

    if (updateUserDb && newCount >= AUTH_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
      const emailToLock = userEmail ?? identifier;
      await this.userRepo.update(
        { email: emailToLock },
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
