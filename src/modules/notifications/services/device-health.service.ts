import { Injectable, Logger, HttpStatus, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { PushSubscription }     from '../entities/push-subscription.entity';
import { DevicePushHealth }     from '../entities/device-push-health.entity';
import { PanicAckTokenService } from './panic-ack-token.service';
import { NotificationsService } from './notifications.service';
import { CustomError }          from '../../shared/utils/errors.utils';
import { GeneralErrorCode }     from '../../shared/constans/error-codes.constants';

/**
 * Prueba de humo de entrega push, por dispositivo.
 *
 * El autostart de los fabricantes no tiene API de consulta: no hay forma de
 * preguntarle a Android si un equipo podrá despertar para atender un push. La
 * única comprobación real es mandar uno y esperar el ACK. Eso es esto.
 *
 * Vive aparte de NotificationsService porque es otra responsabilidad —diagnóstico
 * del canal, no envío de notificaciones— y ese servicio ya carga con demasiado.
 */
@Injectable()
export class DeviceHealthService {
  private readonly logger = new Logger(DeviceHealthService.name);

  /** Un solo fallo puede ser el ascensor; tres seguidos son el fabricante. */
  private static readonly FAILURES_BEFORE_UNHEALTHY = 3;

  constructor(
    @InjectRepository(PushSubscription)
    private readonly pushSubRepo: Repository<PushSubscription>,

    @InjectRepository(DevicePushHealth)
    private readonly healthRepo: Repository<DevicePushHealth>,

    private readonly ackTokenService: PanicAckTokenService,

    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Envía un push de prueba de prioridad alta a un dispositivo.
   *
   * No devuelve si llegó: eso lo confirma el propio equipo llamando a
   * `confirmHealthCheck`. El cliente hace polling o espera unos segundos y
   * consulta el estado — no hay forma de saberlo de forma síncrona, porque la
   * entrega ocurre fuera del proceso.
   */
  async sendHealthCheck(pushSubscriptionId: string): Promise<{ sentAt: Date; token: string }> {
    const subscription = await this.pushSubRepo.findOne({ where: { id: pushSubscriptionId } });

    if (!subscription || !subscription.deviceToken) {
      throw new CustomError({
        message:    'Dispositivo no encontrado o sin token push',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode:  GeneralErrorCode.NOT_FOUND,
      });
    }

    const health = await this.ensureHealthRow(pushSubscriptionId);
    const sentAt = new Date();

    // Se reusa el token de ACK de pánico: mismo esquema HMAC, misma vigencia
    // corta, y el id que firma aquí es el de la fila de salud.
    const token = this.ackTokenService.sign(health.id);

    await this.notificationsService.sendHealthCheckPush(subscription, health.id, token);

    health.lastTestSentAt = sentAt;
    await this.healthRepo.save(health);

    this.logger.log(`Health-check enviado al dispositivo ${pushSubscriptionId}`);
    return { sentAt, token };
  }

  /**
   * El dispositivo confirma que recibió la prueba. Reinicia el contador de
   * fallos y lo marca sano.
   */
  async confirmHealthCheck(healthId: string, token: string): Promise<void> {
    if (!this.ackTokenService.verify(healthId, token)) {
      this.logger.warn(`Health-check rechazado — token inválido para ${healthId}`);
      return;
    }

    await this.healthRepo.update(
      { id: healthId },
      {
        lastTestAckAt:        new Date(),
        consecutiveFailures:  0,
        isHealthy:            true,
      },
    );
    this.logger.log(`Health-check confirmado — ${healthId}`);
  }

  /**
   * Marca como fallidas las pruebas que nunca recibieron ACK.
   *
   * Se ejecuta separado del envío porque no hay forma de "esperar" un ACK: se
   * revisa después quién no contestó.
   */
  async expireStaleChecks(olderThanSeconds = 60): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);

    const stale = await this.healthRepo.find({
      where: { lastTestSentAt: LessThan(cutoff) },
    });

    let marked = 0;
    for (const health of stale) {
      // Contestó después del envío → no cuenta como fallo.
      if (health.lastTestAckAt && health.lastTestAckAt >= health.lastTestSentAt!) continue;

      health.consecutiveFailures += 1;
      health.isHealthy = health.consecutiveFailures < DeviceHealthService.FAILURES_BEFORE_UNHEALTHY;
      await this.healthRepo.save(health);
      marked += 1;
    }

    if (marked > 0) this.logger.warn(`${marked} dispositivos sin responder al health-check`);
    return marked;
  }

  /** Estado actual, para el banner bloqueante de la app y el panel de soporte. */
  async getHealth(pushSubscriptionId: string): Promise<DevicePushHealth> {
    return this.ensureHealthRow(pushSubscriptionId);
  }

  /**
   * Guarda lo que la app reporta de sus permisos. Ninguno es consultable desde
   * el servidor, así que esta es la única visibilidad que soporte tendrá sin
   * pedirle nada al usuario.
   */
  async reportPermissions(
    pushSubscriptionId: string,
    flags: {
      hasBatteryOptimizationDisabled?: boolean;
      hasFullScreenIntentPermission?: boolean;
      hasNotificationPermission?: boolean;
      onboardingCompleted?: boolean;
    },
  ): Promise<DevicePushHealth> {
    const health = await this.ensureHealthRow(pushSubscriptionId);

    if (flags.hasBatteryOptimizationDisabled !== undefined) {
      health.hasBatteryOptimizationDisabled = flags.hasBatteryOptimizationDisabled;
    }
    if (flags.hasFullScreenIntentPermission !== undefined) {
      health.hasFullScreenIntentPermission = flags.hasFullScreenIntentPermission;
    }
    if (flags.hasNotificationPermission !== undefined) {
      health.hasNotificationPermission = flags.hasNotificationPermission;
    }
    // Solo se sella una vez: es la marca de que superó el wizard con una prueba
    // real, y repetirla borraría cuándo ocurrió.
    if (flags.onboardingCompleted && !health.onboardingCompletedAt) {
      health.onboardingCompletedAt = new Date();
    }

    return this.healthRepo.save(health);
  }

  /** Devuelve la fila de salud del dispositivo, creándola si es su primera vez. */
  private async ensureHealthRow(pushSubscriptionId: string): Promise<DevicePushHealth> {
    const existing = await this.healthRepo.findOne({ where: { pushSubscriptionId } });
    if (existing) return existing;

    return this.healthRepo.save(this.healthRepo.create({ pushSubscriptionId }));
  }
}
