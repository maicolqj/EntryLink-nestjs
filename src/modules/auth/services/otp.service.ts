import {
  Injectable,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomInt } from 'crypto';
import { OtpCode } from '../entities/otp-code.entity';
import { OtpProducer } from '../queues/otp.producer';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode } from '../../shared/constans/error-codes.constants';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
    private readonly otpProducer: OtpProducer,
    private readonly cacheService: CacheService,
  ) {}

  // ── Generación y envío ──────────────────────────────────────────────────

  /**
   * Genera un OTP nuevo para el residente, invalida los anteriores pendientes
   * y encola el job de envío por SMS.
   */
  async generateAndSend(userId: string, phoneNumber: string, ip: string): Promise<void> {
    await this.checkRateLimit(phoneNumber, ip);

    // Invalidar OTPs pendientes anteriores del mismo usuario
    await this.otpRepo.update(
      { userId, used: false },
      { used: true },
    );

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + AUTH_CONSTANTS.OTP_EXPIRY_SECONDS * 1_000);

    await this.otpRepo.save(
      this.otpRepo.create({
        userId,
        phoneNumber,
        code,
        expiresAt,
        requestedFromIp: ip,
      }),
    );

    await this.otpProducer.sendOtp({
      userId,
      phoneNumber,
      code,
      expiresInMinutes: AUTH_CONSTANTS.OTP_EXPIRY_SECONDS / 60,
    });

    await this.incrementRateLimit(phoneNumber);

    this.logger.log(`OTP generado para userId: ${userId}`);
  }

  // ── Validación ──────────────────────────────────────────────────────────

  /**
   * Valida el código OTP.
   * Retorna true si es válido y lo marca como usado.
   * Lanza excepción si es inválido/expirado/bloqueado.
   */
  async validate(phoneNumber: string, code: string): Promise<boolean> {
    const otp = await this.otpRepo.findOne({
      where: { phoneNumber, used: false },
      order: { createdAt: 'DESC' },
    });

    if (!otp) {
      throw new CustomError({
        message: 'No hay un código OTP pendiente para este número',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.OTP_NOT_FOUND,
      });
    }

    if (new Date() > otp.expiresAt) {
      await this.otpRepo.update(otp.id, { used: true });
      throw new CustomError({
        message: 'El código OTP ha expirado. Solicita uno nuevo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.OTP_EXPIRED,
      });
    }

    if (otp.attempts >= AUTH_CONSTANTS.MAX_OTP_ATTEMPTS) {
      await this.otpRepo.update(otp.id, { used: true });
      throw new CustomError({
        message: 'Se superaron los intentos máximos. Solicita un nuevo código',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.OTP_MAX_ATTEMPTS,
      });
    }

    if (otp.code !== code) {
      await this.otpRepo.increment({ id: otp.id }, 'attempts', 1);
      const remaining = AUTH_CONSTANTS.MAX_OTP_ATTEMPTS - otp.attempts - 1;
      throw new CustomError({
        message: remaining > 0
          ? `Código incorrecto. Te quedan ${remaining} intentos`
          : 'Código incorrecto. Solicita un nuevo código',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.OTP_INVALID,
      });
    }

    // Código correcto — marcarlo como usado
    await this.otpRepo.update(otp.id, { used: true });
    return true;
  }

  // ── Rate limiting ───────────────────────────────────────────────────────

  private async checkRateLimit(phoneNumber: string, ip: string): Promise<void> {
    const phoneKey = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.OTP_RATE_LIMIT, key: phoneNumber };
    const ipKey    = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.IP_RATE_LIMIT,  key: ip };

    const phoneData = await this.cacheService.get<{ count: number }>(  { key: phoneKey });
    const ipData    = await this.cacheService.get<{ count: number }>({ key: ipKey });

    if ((phoneData?.count ?? 0) >= AUTH_CONSTANTS.OTP_RATE_LIMIT_MAX) {
      throw new CustomError({
        message: `Demasiadas solicitudes de OTP. Espera ${AUTH_CONSTANTS.OTP_RATE_LIMIT_WINDOW / 60} minutos`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.OTP_RATE_LIMIT,
      });
    }

    if ((ipData?.count ?? 0) >= AUTH_CONSTANTS.MAX_IP_ATTEMPTS) {
      throw new CustomError({
        message: 'Demasiadas solicitudes desde tu dirección IP',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.TOO_MANY_IP_ATTEMPTS,
      });
    }
  }

  private async incrementRateLimit(phoneNumber: string): Promise<void> {
    const key = { prefix: AUTH_CONSTANTS.CACHE_PREFIX.OTP_RATE_LIMIT, key: phoneNumber };
    const current = await this.cacheService.get<{ count: number }>({ key });
    await this.cacheService.set({
      key,
      data: { count: (current?.count ?? 0) + 1 },
      options: { ttl: AUTH_CONSTANTS.CACHE_TTL.OTP_RATE_LIMIT },
    });
  }

  // ── Utilitarios ─────────────────────────────────────────────────────────

  private generateCode(): string {
    // Genera un entero aleatorio seguro entre 100000 y 999999
    return String(randomInt(100_000, 1_000_000));
  }

  /** Limpieza periódica de OTPs expirados (puede llamarse con un cron job) */
  async cleanupExpired(): Promise<number> {
    const result = await this.otpRepo.delete({
      expiresAt: LessThan(new Date()),
    });
    return result.affected ?? 0;
  }
}
