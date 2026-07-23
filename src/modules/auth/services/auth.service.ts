import {
  Injectable,
  Logger,
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
import { OtpProducer } from '../queues/otp.producer';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { LoginEmailInput, EMAIL_PASSWORD_USER_ROLES } from '../dto/inputs/login-email.input';
import { LoginSystemCodeInput, SYSTEM_CODE_ROLES } from '../dto/inputs/login-system-code.input';
import { LoginResidentInput } from '../dto/inputs/login-resident.input';
import { RequestOtpInput } from '../dto/inputs/request-otp.input';
import { VerifyOtpInput } from '../dto/inputs/verify-otp.input';
import { AuthResponse, OtpRequestResponse } from '../dto/responses/auth-response';
import { DeviceInfo, TokenPair } from '../interfaces/jwt-payload.interface';
import { QrLoginTokenResponse } from '../dto/responses/qr-login-token.response';
import { SetPasswordResponse } from '../dto/responses/set-password.response';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { Role } from '../../roles/entities/role.entity';
import { RegisterSupervisorInput } from '../dto/inputs/register-supervisor.input';
import { UserErrorCode, AuthErrorCode, ComplexErrorCode } from '../../shared/constans/error-codes.constants';
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
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly otpService: OtpService,
    private readonly otpProducer: OtpProducer,
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
        throw new CustomError({
          message: 'Este usuario no puede iniciar sesión con email y contraseña',
          statusCode: HttpStatus.UNAUTHORIZED,
          errorCode: AuthErrorCode.LOGIN_METHOD_NOT_ALLOWED,
        });
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
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    // VULN-14 fix: verificar password ANTES de revelar estado de cuenta para evitar user enumeration
    // Un atacante no puede distinguir "usuario suspendido" de "password incorrecto"
    const passwordValid = user.password && await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(identity, deviceInfo.ip, true, user.email);
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    const userRoleNames = (user.userRoles ?? []).map(ur => ur.role?.name as ValidRoles);
    const hasValidRole = userRoleNames.some(r =>
      (SYSTEM_CODE_ROLES as readonly ValidRoles[]).includes(r),
    );

    if (!hasValidRole) {
      // Password era correcto pero el rol no aplica — mensaje genérico para no revelar info
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    this.assertUserAccountActive(user);

    await this.clearFailedAttempts(identity);
    this.logger.log(`Login exitoso (identity): userId=${user.id}`);
    return this.createUserSession(user, deviceInfo, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGIN C: Identidad + systemCode (RESIDENT_ROL)
  // ═══════════════════════════════════════════════════════════════

  async loginResident(
    input: LoginResidentInput,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const { identity, systemCode } = input;

    await this.checkIpRateLimit(deviceInfo.ip);

    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.systemCode')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(user.identity) = LOWER(:identity)', { identity: identity.trim() })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      await this.registerFailedAttempt(identity, deviceInfo.ip, false);
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    const isResident = (user.userRoles ?? []).some(
      ur => ur.role?.name === ValidRoles.RESIDENT_ROL,
    );

    if (!isResident) {
      await this.registerFailedAttempt(identity, deviceInfo.ip, false);
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    // Comparar systemCode antes de revelar estado de cuenta (evita user enumeration)
    if (!user.systemCode || user.systemCode.toUpperCase() !== systemCode.trim().toUpperCase()) {
      await this.registerFailedAttempt(identity, deviceInfo.ip, false);
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    this.assertUserAccountActive(user);

    await this.clearFailedAttempts(identity);
    this.logger.log(`Login exitoso (resident identity+systemCode): userId=${user.id}`);
    return this.createUserSession(user, deviceInfo, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // Reenvío del código de sistema por WhatsApp (RESIDENT_ROL)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Reenvía el systemCode (RES-xxxxx) del residente al teléfono registrado
   * vía WhatsApp. Respuesta siempre genérica para no revelar si la identidad
   * existe (anti user-enumeration): los casos inválidos solo se loguean.
   */
  async resendResidentSystemCode(identity: string, ip: string): Promise<OtpRequestResponse> {
    await this.checkIpRateLimit(ip);

    const genericMessage =
      'Si la identidad está registrada, recibirás tu código por WhatsApp en los próximos segundos';

    const identityKey = identity.trim().toLowerCase();
    const rateKey = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.SYSTEM_CODE_RATE_LIMIT, key: identityKey };
    const rateData = await this.cacheService.get<{ count: number }>({ key: rateKey });

    if ((rateData?.count ?? 0) >= AUTH_CONSTANTS.SYSTEM_CODE_RATE_LIMIT_MAX) {
      throw new CustomError({
        message: `Demasiadas solicitudes. Espera ${AUTH_CONSTANTS.SYSTEM_CODE_RATE_LIMIT_WINDOW / 60} minutos`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.OTP_RATE_LIMIT,
      });
    }

    await this.cacheService.set({
      key: rateKey,
      data: { count: (rateData?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.SYSTEM_CODE_RATE_LIMIT },
    });

    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.systemCode')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .where('LOWER(user.identity) = LOWER(:identity)', { identity: identity.trim() })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      this.logger.warn(`Reenvío de systemCode para identidad no registrada`);
      return { success: true, message: genericMessage };
    }

    const isResident = (user.userRoles ?? []).some(ur => ur.role?.name === ValidRoles.RESIDENT_ROL);
    if (!isResident) {
      this.logger.warn(`Reenvío de systemCode para usuario no-residente: ${user.id}`);
      return { success: true, message: genericMessage };
    }

    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn(`Reenvío de systemCode para cuenta no activa: ${user.id} (${user.status})`);
      return { success: true, message: genericMessage };
    }

    if (!user.systemCode || !user.phoneNumber) {
      this.logger.warn(`Reenvío de systemCode sin código o teléfono registrado: ${user.id}`);
      return { success: true, message: genericMessage };
    }

    await this.otpProducer.sendSystemCode({
      userId: user.id,
      phoneNumber: user.phoneNumber,
      systemCode: user.systemCode,
    });

    this.logger.log(`Reenvío de systemCode encolado: userId=${user.id}`);
    return { success: true, message: genericMessage };
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGIN D: Teléfono + OTP (RESIDENT_ROL - flujo alternativo)
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

    if (!user) throw new CustomError({
      message: 'Número de celular no registrado',
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: UserErrorCode.USER_NOT_FOUND,
    });

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
      throw new CustomError({
        message: `Complejo con ID "${complexId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000);


    // PIN = últimos 4 dígitos del NIT base (antes del dígito de verificación tras "-")
    const nitBase = (complex.nit ?? '').split('-')[0].replace(/\D/g, '');
    if (nitBase.length < 4) {
      throw new CustomError({
        message: 'NIT del complejo no tiene suficientes dígitos para generar el PIN',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.QR_PIN_GENERATION_FAILED,
      });
    }
    const rawPin = nitBase.slice(-4);
    const hashedPin = await bcrypt.hash(rawPin, 12);

    const updateResult = await this.complexRepo.update(complexId, {
      qrLoginToken: token,
      qrLoginTokenExp: expiresAt,
      qrLoginTokenUsed: false,
      qrLoginPin: hashedPin,
    });

    this.logger.log(
      `QR login token generado para complejo ${complexId} | affected: ${updateResult.affected} | pinLen: ${rawPin.length} | hashLen: ${hashedPin.length} | hashPrefix: ${hashedPin.substring(0, 7)}`,
    );
    return { token, expiresAt, pin: rawPin };
  }

  // ═══════════════════════════════════════════════════════════════
  // QR Login: canjear token (el complejo escanea el QR)
  // ═══════════════════════════════════════════════════════════════

  async redeemQrToken(token: string, pin: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const normalizedPin = (pin ?? '').trim();

    if (!normalizedPin) {
      throw new CustomError({
        message: 'PIN es requerido',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.QR_PIN_REQUIRED,
      });
    }

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
      throw new CustomError({
        message: 'Token QR no válido',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AuthErrorCode.QR_TOKEN_INVALID,
      });
    }

    if (complex.qrLoginTokenUsed) {
      throw new CustomError({
        message: 'Este token QR ya fue utilizado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.QR_TOKEN_ALREADY_USED,
      });
    }

    if (!complex.qrLoginTokenExp || new Date() > complex.qrLoginTokenExp) {
      throw new CustomError({
        message: 'El token QR ha expirado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.QR_TOKEN_EXPIRED,
      });
    }

    if (!complex.qrLoginPin) {
      throw new CustomError({
        message: 'PIN no configurado para este token QR',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.QR_PIN_NOT_CONFIGURED,
      });
    }

    this.logger.debug(
      `[QR redeem] complexId: ${complex.id} | pinLen: ${normalizedPin.length} | hashLen: ${complex.qrLoginPin.length} | hashPrefix: ${complex.qrLoginPin.substring(0, 7)}`,
    );

    const pinValid = await bcrypt.compare(normalizedPin, complex.qrLoginPin);
    if (!pinValid) {
      this.logger.warn(`PIN incorrecto al canjear QR — complexId: ${complex.id} | pinLen: ${normalizedPin.length} | hashLen: ${complex.qrLoginPin.length} | hashPrefix: ${complex.qrLoginPin.substring(0, 7)}`);
      throw new CustomError({
        message: 'PIN incorrecto',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.QR_PIN_INVALID,
      });
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
      throw new CustomError({
        message: 'No se encontró el propietario del complejo',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AuthErrorCode.COMPLEX_OWNER_NOT_FOUND,
      });
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
  // Registro de supervisor + verificación de email
  // ═══════════════════════════════════════════════════════════════

  async registerSupervisor(input: RegisterSupervisorInput): Promise<RegisterSupervisorResponse> {
    const { fullName, email, password, phone, documentNumber } = input;

    const existing = await this.userRepo.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return { success: false, message: 'Si el correo no está registrado, recibirás un enlace de verificación', supervisorId: null };
    }

    const supervisorRole = await this.roleRepo.findOne({ where: { name: ValidRoles.SUPERVISOR_ROL } });
    if (!supervisorRole) throw new CustomError({
      message: 'Rol de supervisor no configurado',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: AuthErrorCode.ROLE_NOT_CONFIGURED,
    });

    const saltRounds = this.configService.get<number>('BCRYPT_ROUNDS', 12);
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const nameParts = fullName.trim().split(/\s+/);
    const name = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || nameParts[0];

    const user = await this.dataSource.transaction(async (em) => {
      const newUser = em.create(User, {
        name,
        lastName,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        passwordSet: true,
        phoneNumber: phone,
        identity: documentNumber,
        status: UserStatus.PENDING_VERIFICATION,
        emailVerified: false,
        phoneVerified: false,
        identityVerified: false,
      });
      const savedUser = await em.save(User, newUser);

      const userRole = em.create(UserRole, {
        user: savedUser,
        role: supervisorRole,
        isPrimary: true,
      });
      await em.save(UserRole, userRole);

      return savedUser;
    });

    const token = uuidv4();
    const ttl = AUTH_CONSTANTS.EMAIL_VERIFICATION_EXPIRY_MINUTES * 60;
    await this.cacheService.set({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.EMAIL_VERIFICATION_TOKEN, key: token },
      data: { userId: user.id },
      options: { ttl },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
    const verificationUrl = `${frontendUrl}/auth/verify-email?token=${token}`;

    await this.mailService.queueEmailVerificationEmail({
      userId: user.id,
      email: user.email,
      name: user.name,
      verificationUrl,
      expiresInMinutes: AUTH_CONSTANTS.EMAIL_VERIFICATION_EXPIRY_MINUTES,
    });

    this.logger.log(`Supervisor registrado: userId=${user.id}`);
    return { success: true, message: 'Revisa tu correo para verificar tu cuenta', supervisorId: user.id };
  }

  async verifySupervisorEmail(token: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const cached = await this.cacheService.get<{ userId: string }>({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.EMAIL_VERIFICATION_TOKEN, key: token },
    });

    if (!cached?.userId) throw new CustomError({
      message: 'Token de verificación inválido o expirado',
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: UserErrorCode.INVALID_TOKEN,
    });

    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('user.id = :id', { id: cached.userId })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) throw new CustomError({
      message: 'Usuario no encontrado',
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: UserErrorCode.USER_NOT_FOUND,
    });
    if (user.status !== UserStatus.PENDING_VERIFICATION) throw new CustomError({
      message: 'La cuenta ya fue verificada',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: AuthErrorCode.ACCOUNT_ALREADY_VERIFIED,
    });

    await this.userRepo.update(user.id, { emailVerified: true, status: UserStatus.ACTIVE });
    await this.cacheService.delete({ key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.EMAIL_VERIFICATION_TOKEN, key: token } });

    user.emailVerified = true;
    user.status = UserStatus.ACTIVE;

    this.logger.log(`Email verificado — userId=${user.id}`);
    return this.createUserSession(user, deviceInfo, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // Reset de contraseña por email
  // ═══════════════════════════════════════════════════════════════

  async requestPasswordReset(email: string): Promise<RequestPasswordResetResponse> {
    const genericResponse = { success: true, message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña' };

    const rlKey = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.PASSWORD_RESET_RATE_LIMIT, key: email.toLowerCase() };
    const rl = await this.cacheService.get<{ count: number }>({ key: rlKey });
    if ((rl?.count ?? 0) >= AUTH_CONSTANTS.PASSWORD_RESET_RATE_LIMIT_MAX) return genericResponse;

    await this.cacheService.set({
      key: rlKey,
      data: { count: (rl?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.PASSWORD_RESET_RATE_LIMIT },
    });

    const user = await this.userRepo.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user) return genericResponse;

    const token = uuidv4();
    const ttl = AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES * 60;
    await this.cacheService.set({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.PASSWORD_RESET_TOKEN, key: token },
      data: { userId: user.id },
      options: { ttl },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

    await this.mailService.queuePasswordResetEmail({
      userId: user.id,
      email: user.email,
      name: user.name,
      resetUrl,
      expiresInMinutes: AUTH_CONSTANTS.PASSWORD_RESET_EXPIRY_MINUTES,
    });

    this.logger.log(`Password reset solicitado — userId=${user.id}`);
    return genericResponse;
  }

  async resetPassword(input: ResetPasswordInput): Promise<SetPasswordResponse> {
    const cached = await this.cacheService.get<{ userId: string }>({
      key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.PASSWORD_RESET_TOKEN, key: input.token },
    });

    if (!cached?.userId) throw new CustomError({
      message: 'Token inválido o expirado',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: UserErrorCode.INVALID_TOKEN,
    });

    const user = await this.userRepo.findOne({ where: { id: cached.userId } });
    if (!user) throw new CustomError({
      message: 'Usuario no encontrado',
      statusCode: HttpStatus.NOT_FOUND,
      errorCode: UserErrorCode.USER_NOT_FOUND,
    });

    const saltRounds = this.configService.get<number>('BCRYPT_ROUNDS', 12);
    const hashedPassword = await bcrypt.hash(input.newPassword, saltRounds);

    await this.userRepo.update(user.id, {
      password: hashedPassword,
      lastPasswordChange: new Date(),
      tokenVersion: () => '"tokenVersion" + 1',
    });

    await this.cacheService.delete({ key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.PASSWORD_RESET_TOKEN, key: input.token } });
    await this.tokenService.clearUserTokenVersionCache(user.id);

    this.logger.log(`Password restablecido — userId=${user.id}`);
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
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
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
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    const passwordValid = await bcrypt.compare(password, complex.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(email, deviceInfo.ip, false);
      throw new CustomError({
        message: 'Credenciales inválidas',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.INVALID_CREDENTIALS,
      });
    }

    this.assertComplexAccountActive(complex);

    if (!complex.owner) {
      throw new CustomError({
        message: 'No se encontró el propietario del complejo',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.COMPLEX_OWNER_NOT_FOUND,
      });
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
      throw new CustomError({
        message: 'El complejo residencial está inactivo. Contacta al administrador',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.COMPLEX_INACTIVE,
      });
    }
    if (complex.status === ComplexStatus.SUSPENDED) {
      throw new CustomError({
        message: 'El complejo residencial está suspendido. Contacta al administrador',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.COMPLEX_SUSPENDED,
      });
    }
  }

  /** Valida que la cuenta User esté activa (no eliminada, no bloqueada, no suspendida). */
  private assertUserAccountActive(user: User): void {
    if (user.deletedAt) {
      throw new CustomError({
        message: 'La cuenta ha sido eliminada',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.USER_DELETED,
      });
    }

    if (user.accountLockedUntil && new Date() < user.accountLockedUntil) {
      const unlockIn = Math.ceil((user.accountLockedUntil.getTime() - Date.now()) / 60_000);
      throw new CustomError({
        message: `Cuenta bloqueada temporalmente. Intenta en ${unlockIn} minuto(s)`,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: UserErrorCode.ACCOUNT_LOCKED,
      });
    }


    const blockedStatuses: UserStatus[] = [
      UserStatus.SUSPENDED,
      UserStatus.BANNED,
      UserStatus.INACTIVE,
      UserStatus.PENDING_VERIFICATION,
    ];

    if (blockedStatuses.includes(user.status)) {
      const isPending = user.status === UserStatus.PENDING_VERIFICATION;
      throw new CustomError({
        message: isPending
          ? 'Debes verificar tu correo electrónico antes de iniciar sesión'
          : 'Tu cuenta está suspendida o inactiva. Contacta al administrador',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: isPending
          ? AuthErrorCode.EMAIL_VERIFICATION_REQUIRED
          : UserErrorCode.USER_SUSPENDED,
      });
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
      throw new CustomError({
        message: 'Demasiados intentos desde tu dirección IP. Intenta más tarde',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.TOO_MANY_IP_ATTEMPTS,
      });
    }

    await this.cacheService.set({
      key,
      data: { count: (data?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.FAILED_ATTEMPTS },
    });
  }
}
