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
  // LOGIN B: Email + Código de sistema
  //   - SUPERVISOR_ROL → users
  //   - SECURITY_ROL   → users
  //   - RESIDENT_ROL   → users
  // ═══════════════════════════════════════════════════════════════

  async loginWithSystemCode(
    input: LoginSystemCodeInput,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    const { email, systemCode } = input;

    await this.checkIpRateLimit(deviceInfo.ip);

    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.systemCode')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      await this.registerFailedAttempt(email, deviceInfo.ip);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const userRoleNames = (user.userRoles ?? []).map(ur => ur.role?.name as ValidRoles);
    const hasValidRole = userRoleNames.some(r =>
      (SYSTEM_CODE_ROLES as readonly ValidRoles[]).includes(r),
    );

    if (!hasValidRole) {
      throw new UnauthorizedException('Este usuario no puede iniciar sesión con código de sistema');
    }

    this.assertUserAccountActive(user);

    if (!user.systemCode || user.systemCode !== systemCode) {
      await this.registerFailedAttempt(email, deviceInfo.ip);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.clearFailedAttempts(email);
    this.logger.log(`Login exitoso (systemCode): userId=${user.id}`);
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

    if (process.env.NODE_ENV !== 'production') {
      const otp = await this.userRepo.manager.query(
        `SELECT code FROM otp_codes WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );
      return { success: true, message: genericMessage, debugCode: otp[0]?.code };
    }

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

    await this.complexRepo.update(complexId, {
      qrLoginToken: token,
      qrLoginTokenExp: expiresAt,
      qrLoginTokenUsed: false,
    });

    this.logger.log(`QR login token generado para complejo ${complexId}`);
    return { token, expiresAt };
  }

  // ═══════════════════════════════════════════════════════════════
  // QR Login: canjear token (el complejo escanea el QR)
  // ═══════════════════════════════════════════════════════════════

  async redeemQrToken(token: string, pin: string, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const complex = await this.complexRepo
      .createQueryBuilder('complex')
      .addSelect('complex.qrLoginToken')
      .addSelect('complex.qrLoginTokenExp')
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

    if (!complex.nit) {
      throw new BadRequestException('El complejo no tiene NIT registrado');
    }

    const nitBase = complex.nit.split('-')[0];
    const expectedPin = nitBase.slice(-4);

    if (pin !== expectedPin) {
      this.logger.warn(`PIN incorrecto al canjear QR — complexId: ${complex.id}`);
      throw new UnauthorizedException('PIN incorrecto');
    }

    // Invalidar el token antes de crear la sesión (one-time use)
    await this.complexRepo.update(complex.id, {
      qrLoginTokenUsed: true,
      qrLoginToken: null as unknown as string,
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
    const hashedPassword = await bcrypt.hash(newPassword, Number(process.env.HASHSALT) || 10);

    await this.complexRepo.update(complexId, {
      password: hashedPassword,
      lastPasswordChange: new Date(),
      passwordSet: true,
      qrLoginToken: null as unknown as string,
      qrLoginTokenExp: null as unknown as Date,
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
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    // 1. Verificar que el email no esté en uso
    const existing = await this.userRepo.findOne({
      where: { email: input.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new CustomError({
        message: 'Este correo electrónico ya está registrado',
        statusCode: HttpStatus.CONFLICT,
        errorCode: UserErrorCode.EMAIL_ALREADY_IN_USE,
      });
    }

    // 2. Obtener rol SUPERVISOR_ROL de la BD
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

    // 3. Crear usuario + asignación de rol en una transacción
    const [firstName, ...rest] = input.fullName.trim().split(' ');
    const lastName = rest.join(' ') || firstName;

    const user = await this.dataSource.transaction(async (manager) => {
      const newUser = manager.create(User, {
        name:             firstName,
        lastName:         lastName,
        email:            input.email,
        password:         input.password,    // BeforeInsert hashea automáticamente
        phoneNumber:      input.phone,
        identity:         input.documentNumber,
        status:           UserStatus.ACTIVE,
        passwordSet:      true,
        phoneVerified:    false,
        emailVerified:    false,
        identityVerified: false,
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

    this.logger.log(`Supervisor auto-registrado: userId=${user.id} | email=${user.email}`);

    // 4. Recargar el usuario con sus roles para generar el JWT correctamente
    const userWithRoles = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('user.id = :id', { id: user.id })
      .getOne();

    return this.createUserSession(userWithRoles, deviceInfo, false);
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

    const blockedStatuses: UserStatus[] = [UserStatus.SUSPENDED, UserStatus.BANNED];
    if (blockedStatuses.includes(user.status)) {
      throw new UnauthorizedException('Tu cuenta está suspendida. Contacta al administrador');
    }
  }

  // ── Rate limiting ───────────────────────────────────────────────────────

  private async registerFailedAttempt(
    identifier: string,
    ip: string,
    updateUserDb = true,
  ): Promise<void> {
    const key = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.FAILED_ATTEMPTS, key: identifier };
    const current = await this.cacheService.get<{ count: number }>({ key });
    const newCount = (current?.count ?? 0) + 1;

    if (updateUserDb && newCount >= AUTH_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
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
