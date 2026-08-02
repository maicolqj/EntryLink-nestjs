import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { randomBytes } from 'crypto';

import { WhatsAppLoginChallenge } from '../entities/whatsapp-login-challenge.entity';
import { WhatsAppLoginStatus } from '../enums/whatsapp-login-status.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { ResidentDeviceService } from './resident-device.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { AuthResponse } from '../dto/responses/auth-response';
import { WhatsAppLoginChallengeResponse } from '../dto/responses/whatsapp-login-challenge.response';
import { WhatsAppLoginStatusResponse } from '../dto/responses/whatsapp-login-status.response';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode, UserErrorCode } from '../../shared/constans/error-codes.constants';
import { normalizeColombianPhone, maskPhone } from '../utils/phone.util';

/** Alfabeto sin caracteres ambiguos: el residente puede tener que teclear el nonce. */
const NONCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Login de residentes por mensaje ENTRANTE de WhatsApp ("reverse-OTP").
 *
 * En el flujo clásico el sistema envía el código: eso es una plantilla de
 * autenticación de Meta y se cobra por mensaje. Aquí se invierte la dirección
 * —el residente envía un nonce desde su propio WhatsApp— y como los mensajes
 * entrantes no tienen costo, el flujo es gratuito de forma estructural, no por
 * estar dentro de una cuota.
 *
 * Secuencia:
 *   1. `requestChallenge(documento)` → nonce + link `wa.me` prellenado.
 *   2. El residente pulsa enviar. Meta dispara el webhook entrante.
 *   3. `confirmFromInboundMessage` valida que el teléfono remitente sea el del
 *      dueño de ese documento y marca el challenge como CONFIRMED.
 *   4. `redeem(challengeId)` entrega los tokens.
 *
 * Reparto de secretos: el nonce viaja por WhatsApp (se asume público) y solo
 * identifica el intento; el `challengeId` no sale del cliente que lo pidió y es
 * lo único que canjea la sesión. Además el canje exige el mismo fingerprint de
 * dispositivo que abrió el flujo.
 */
@Injectable()
export class WhatsAppLoginService {
  private readonly logger = new Logger(WhatsAppLoginService.name);
  private readonly businessNumber: string | undefined;
  private readonly keyword: string;

  constructor(
    @InjectRepository(WhatsAppLoginChallenge)
    private readonly challengeRepo: Repository<WhatsAppLoginChallenge>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly residentDeviceService: ResidentDeviceService,
    private readonly cacheService: CacheService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('WHATSAPP_BUSINESS_NUMBER');
    this.businessNumber = raw ? normalizeColombianPhone(raw) : undefined;
    this.keyword = (this.config.get<string>('WHATSAPP_LOGIN_KEYWORD') ?? 'INGRESAR').toUpperCase();

    if (!this.businessNumber) {
      this.logger.warn(
        'WHATSAPP_BUSINESS_NUMBER sin configurar: el login por WhatsApp entrante queda deshabilitado.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.businessNumber !== undefined;
  }

  // ── Paso 1: emitir el challenge ───────────────────────────────────────────

  /**
   * Emite un nonce y el link `wa.me` que el residente debe enviar.
   *
   * Se emite SIEMPRE, exista o no la identidad: un challenge que no
   * corresponde a nadie simplemente nunca se confirma. Responder distinto
   * convertiría este endpoint en un oráculo de qué documentos están
   * registrados en el conjunto residencial.
   */
  async requestChallenge(
    identity: string,
    deviceInfo: DeviceInfo,
  ): Promise<WhatsAppLoginChallengeResponse> {
    if (!this.businessNumber) {
      throw new CustomError({
        message: 'El login por WhatsApp no está disponible',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: AuthErrorCode.WA_LOGIN_NOT_CONFIGURED,
      });
    }

    const identityKey = identity.trim().toLowerCase();
    await this.checkRateLimit(identityKey);

    const user = await this.findResidentByIdentity(identityKey);

    // Invalidar los intentos previos de esta identidad: un solo nonce vivo a la
    // vez evita que el residente envíe por error uno viejo.
    await this.challengeRepo.update(
      { identity: identityKey, status: WhatsAppLoginStatus.PENDING },
      { status: WhatsAppLoginStatus.EXPIRED },
    );

    const nonce = await this.generateUniqueNonce();
    const expiresAt = new Date(Date.now() + AUTH_CONSTANTS.WA_LOGIN_CHALLENGE_EXPIRY_SECONDS * 1_000);

    const challenge = await this.challengeRepo.save(
      this.challengeRepo.create({
        nonce,
        identity: identityKey,
        userId: user?.id,
        status: WhatsAppLoginStatus.PENDING,
        expiresAt,
        deviceFingerprint: deviceInfo.fingerprint,
        requestedFromIp: deviceInfo.ip,
      }),
    );

    const text = `${this.keyword} ${nonce}`;

    this.logger.log(
      `Challenge de login por WhatsApp emitido — id: ${challenge.id} | vinculado: ${user ? 'sí' : 'no'}`,
    );

    return {
      challengeId: challenge.id,
      nonce,
      whatsappUrl: `https://wa.me/${this.businessNumber}?text=${encodeURIComponent(text)}`,
      messageText: text,
      expiresAt,
      warning:
        'Enviar este mensaje inicia sesión en el dispositivo donde lo solicitaste. ' +
        'Si alguien más te pidió enviarlo, no lo hagas.',
    };
  }

  // ── Paso 2: confirmar desde el webhook ────────────────────────────────────

  /**
   * Procesa un mensaje entrante. Lo llama el webhook de Meta.
   *
   * No lanza: un error aquí solo debe quedar en logs, porque el webhook debe
   * responder 200 a Meta pase lo que pase (un no-2xx repetido hace que Meta
   * deshabilite la suscripción).
   */
  async confirmFromInboundMessage(fromPhone: string, text: string): Promise<void> {
    const nonce = this.extractNonce(text);
    if (!nonce) return;

    const challenge = await this.challengeRepo.findOne({
      where: { nonce, status: WhatsAppLoginStatus.PENDING },
    });

    if (!challenge) {
      this.logger.warn('[WA-LOGIN] Nonce entrante sin challenge pendiente');
      return;
    }

    if (new Date() > challenge.expiresAt) {
      await this.challengeRepo.update(challenge.id, { status: WhatsAppLoginStatus.EXPIRED });
      this.logger.warn(`[WA-LOGIN] Nonce entrante vencido — id: ${challenge.id}`);
      return;
    }

    // Identidad inexistente: el challenge se emitió solo para no filtrar
    // información. Nunca puede confirmarse.
    if (!challenge.userId) {
      this.logger.warn(`[WA-LOGIN] Nonce de identidad no registrada — id: ${challenge.id}`);
      return;
    }

    const user = await this.userRepo.findOne({ where: { id: challenge.userId } });
    if (!user?.phoneNumber) {
      this.logger.warn(`[WA-LOGIN] Usuario del challenge sin teléfono — id: ${challenge.id}`);
      return;
    }

    const from = normalizeColombianPhone(fromPhone);
    const expected = normalizeColombianPhone(user.phoneNumber);

    // Núcleo del control: el nonce solo vale si lo envía el teléfono del dueño
    // del documento que se escribió al pedirlo. Un tercero que consiga el nonce
    // no puede confirmarlo desde su propio WhatsApp.
    if (from !== expected) {
      this.logger.warn(
        `[WA-LOGIN] Teléfono remitente no coincide — id: ${challenge.id} | from: ${maskPhone(from)}`,
      );
      return;
    }

    await this.challengeRepo.update(challenge.id, {
      status: WhatsAppLoginStatus.CONFIRMED,
      confirmedAt: new Date(),
      confirmedFromPhone: from,
    });

    this.logger.log(`[WA-LOGIN] Challenge confirmado — id: ${challenge.id} | userId: ${user.id}`);
  }

  // ── Paso 3: estado y canje ────────────────────────────────────────────────

  /** Consulta el estado. El cliente hace polling hasta CONFIRMED. */
  async getStatus(challengeId: string, deviceInfo: DeviceInfo): Promise<WhatsAppLoginStatusResponse> {
    const challenge = await this.findChallengeForDevice(challengeId, deviceInfo);

    if (
      challenge.status === WhatsAppLoginStatus.PENDING &&
      new Date() > challenge.expiresAt
    ) {
      await this.challengeRepo.update(challenge.id, { status: WhatsAppLoginStatus.EXPIRED });
      return { status: WhatsAppLoginStatus.EXPIRED, expiresAt: challenge.expiresAt };
    }

    return { status: challenge.status, expiresAt: challenge.expiresAt };
  }

  /**
   * Canjea un challenge confirmado por una sesión. Un solo uso.
   *
   * Si la cuenta ya tiene clave de acceso, hay que enviarla: quien roba el
   * teléfono se lleva también la línea de WhatsApp, así que la posesión sola no
   * puede bastar para vincular un equipo. Solo el primer ingreso —cuando
   * todavía no hay clave— entra sin ese segundo factor, que es justo el momento
   * en que el residente la crea.
   */
  async redeem(
    challengeId: string,
    deviceInfo: DeviceInfo,
    accessCode?: string,
  ): Promise<AuthResponse> {
    const challenge = await this.findChallengeForDevice(challengeId, deviceInfo);

    if (challenge.status === WhatsAppLoginStatus.CONSUMED) {
      throw new CustomError({
        message: 'Este intento de inicio de sesión ya fue usado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.WA_LOGIN_CHALLENGE_CONSUMED,
      });
    }

    if (challenge.status === WhatsAppLoginStatus.EXPIRED || new Date() > challenge.expiresAt) {
      await this.challengeRepo.update(challenge.id, { status: WhatsAppLoginStatus.EXPIRED });
      throw new CustomError({
        message: 'El intento de inicio de sesión venció. Solicita uno nuevo',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.WA_LOGIN_CHALLENGE_EXPIRED,
      });
    }

    if (challenge.status !== WhatsAppLoginStatus.CONFIRMED) {
      throw new CustomError({
        message: 'Todavía no recibimos tu mensaje de WhatsApp',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.WA_LOGIN_CHALLENGE_PENDING,
      });
    }

    // Marcar consumido ANTES de emitir tokens: si dos peticiones entran a la
    // vez, solo la que gana el UPDATE condicional sigue adelante.
    const consumed = await this.challengeRepo.update(
      { id: challenge.id, status: WhatsAppLoginStatus.CONFIRMED },
      { status: WhatsAppLoginStatus.CONSUMED },
    );

    if (!consumed.affected) {
      throw new CustomError({
        message: 'Este intento de inicio de sesión ya fue usado',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.WA_LOGIN_CHALLENGE_CONSUMED,
      });
    }

    const user = await this.loadResidentWithRoles(challenge.userId);
    this.assertUserActive(user);

    await this.assertAccessCodeWhenRequired(user.id, deviceInfo, accessCode);

    await this.residentDeviceService.linkDevice(user.id, deviceInfo);

    // Este ingreso probó identidad por un canal externo: habilita fijar una
    // clave nueva sin conocer la anterior durante los próximos minutos.
    await this.residentDeviceService.grantResetPermission(user.id);

    await this.sessionService.enforceSessionLimit(user.id, AUTH_CONSTANTS.MAX_SESSIONS_PER_USER);

    const tokenPair = await this.tokenService.generateTokenPair(user, deviceInfo, false, 'user');

    await this.sessionService.createOrUpdateSession(user.id, tokenPair.sessionId, deviceInfo);

    this.logger.log(`Login por WhatsApp entrante — userId: ${user.id} | sessionId: ${tokenPair.sessionId}`);

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      sessionId: tokenPair.sessionId,
    };
  }

  /**
   * Exige la clave de la cuenta cuando ya existe. Se resuelve acá y no en el
   * resolver para que valga igual desde cualquier entrada.
   */
  private async assertAccessCodeWhenRequired(
    userId: string,
    deviceInfo: DeviceInfo,
    accessCode?: string,
  ): Promise<void> {
    const hasCode = await this.residentDeviceService.hasAccessCode(userId);
    if (!hasCode) return;

    // El segundo factor protege el alta de un equipo NUEVO. Si este ya está
    // vinculado, exigirlo dejaría sin salida a quien olvidó la clave: es
    // justamente el camino por el que vuelve a entrar para cambiarla.
    if (await this.residentDeviceService.isDeviceLinked(userId, deviceInfo)) return;

    if (!accessCode?.trim()) {
      throw new CustomError({
        message: 'Ingresa tu clave de acceso para autorizar este dispositivo',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: AuthErrorCode.ACCESS_CODE_REQUIRED,
      });
    }

    await this.residentDeviceService.verifyAccessCode(userId, accessCode);
  }

  /** Borra los challenges ya resueltos o vencidos. Para un cron de limpieza. */
  async cleanupExpired(): Promise<number> {
    const result = await this.challengeRepo.delete({
      expiresAt: LessThan(new Date()),
      status: In([
        WhatsAppLoginStatus.EXPIRED,
        WhatsAppLoginStatus.CONSUMED,
        WhatsAppLoginStatus.PENDING,
      ]),
    });
    return result.affected ?? 0;
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  /**
   * Carga el challenge exigiendo que sea el mismo dispositivo que lo pidió.
   * Devuelve el mismo error para "no existe" y "otro dispositivo": el cliente
   * legítimo nunca ve esa diferencia y no hay nada que ganar revelándola.
   */
  private async findChallengeForDevice(
    challengeId: string,
    deviceInfo: DeviceInfo,
  ): Promise<WhatsAppLoginChallenge> {
    const challenge = await this.challengeRepo.findOne({ where: { id: challengeId } });

    if (!challenge) {
      throw new CustomError({
        message: 'Intento de inicio de sesión no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AuthErrorCode.WA_LOGIN_CHALLENGE_NOT_FOUND,
      });
    }

    if (challenge.deviceFingerprint !== deviceInfo.fingerprint) {
      this.logger.warn(`[WA-LOGIN] Canje desde dispositivo distinto — id: ${challenge.id}`);
      throw new CustomError({
        message: 'Intento de inicio de sesión no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AuthErrorCode.WA_LOGIN_CHALLENGE_NOT_FOUND,
      });
    }

    return challenge;
  }

  /** Extrae el nonce del texto entrante, tolerando mayúsculas y espacios extra. */
  private extractNonce(text: string): string | null {
    const normalized = (text ?? '').trim().toUpperCase();
    const pattern = new RegExp(
      `${this.keyword}\\s+([${NONCE_ALPHABET}]{${AUTH_CONSTANTS.WA_LOGIN_NONCE_LENGTH}})`,
    );

    return normalized.match(pattern)?.[1] ?? null;
  }

  private async generateUniqueNonce(): Promise<string> {
    // La unicidad final la garantiza el índice único; estos reintentos solo
    // evitan que una colisión (improbable con 32^8) llegue como error 500.
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = randomBytes(AUTH_CONSTANTS.WA_LOGIN_NONCE_LENGTH);
      let nonce = '';
      for (let i = 0; i < AUTH_CONSTANTS.WA_LOGIN_NONCE_LENGTH; i++) {
        nonce += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length];
      }

      const exists = await this.challengeRepo.findOne({ where: { nonce }, select: { id: true } });
      if (!exists) return nonce;
    }

    throw new Error('No se pudo generar un nonce único para el login por WhatsApp');
  }

  private async checkRateLimit(identityKey: string): Promise<void> {
    const key = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.WA_LOGIN_RATE_LIMIT, key: identityKey };
    const data = await this.cacheService.get<{ count: number }>({ key });

    if ((data?.count ?? 0) >= AUTH_CONSTANTS.WA_LOGIN_RATE_LIMIT_MAX) {
      throw new CustomError({
        message: `Demasiadas solicitudes. Espera ${AUTH_CONSTANTS.WA_LOGIN_RATE_LIMIT_WINDOW / 60} minutos`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.WA_LOGIN_RATE_LIMIT,
      });
    }

    await this.cacheService.set({
      key,
      data: { count: (data?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.WA_LOGIN_RATE_LIMIT },
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
