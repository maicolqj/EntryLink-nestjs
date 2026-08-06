import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { PanicAlert }               from '../entities/panic-alert.entity';
import { PanicAlertDelivery }       from '../entities/panic-alert-delivery.entity';
import { PanicEscalationSettings }  from '../entities/panic-escalation-settings.entity';
import { PanicAlertStatus }         from '../enums/panic-alert-status.enum';
import { PanicDeliveryChannel }     from '../enums/panic-delivery-channel.enum';
import { NotificationsService }     from '../services/notifications.service';
import { ValidRoles }               from '../../roles/enums/valid-roles';
import { PanicChannel, PanicChannelContext } from '../channels/panic-channel.interface';
import { SocketPanicChannel }       from '../channels/socket-panic.channel';
import { EmailPanicChannel }        from '../channels/email-panic.channel';
import { FcmRepushPanicChannel }    from '../channels/fcm-repush.channel';
import {
  WhatsAppPanicChannel,
  SmsPanicChannel,
  VoicePanicChannel,
} from '../channels/unavailable-panic.channels';
import {
  PANIC_ESCALATION_QUEUE,
  PANIC_ESCALATION_JOBS,
  PanicEscalationJobPayload,
  panicEscalationJobId,
} from './panic-escalation.queue.constants';

/**
 * Escalamiento de alertas de pánico no atendidas.
 *
 *   nivel 1  → nadie confirmó ENTREGA    → canales alternos a todo el personal
 *   nivel 2  → nadie RECONOCIÓ           → supervisores y administración
 *   nivel 3  → sigue sin reconocer       → contacto de emergencia + SUPER_ADMIN
 *
 * Cada nivel encola el siguiente solo si él mismo llegó a ejecutarse, así que
 * cancelar es sencillamente no encolar: no quedan jobs huérfanos esperando por
 * una alerta ya cerrada. Además, reconocer la alerta borra el job pendiente por
 * su id determinista, para no depender de que el worker despierte a descartarlo.
 */
@Processor(PANIC_ESCALATION_QUEUE)
export class PanicEscalationProcessor extends WorkerHost {
  private readonly logger = new Logger(PanicEscalationProcessor.name);

  constructor(
    @InjectQueue(PANIC_ESCALATION_QUEUE)
    private readonly queue: Queue,

    @InjectRepository(PanicAlert)
    private readonly panicRepo: Repository<PanicAlert>,

    @InjectRepository(PanicAlertDelivery)
    private readonly deliveryRepo: Repository<PanicAlertDelivery>,

    @InjectRepository(PanicEscalationSettings)
    private readonly settingsRepo: Repository<PanicEscalationSettings>,

    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,

    private readonly socketChannel:   SocketPanicChannel,
    private readonly emailChannel:    EmailPanicChannel,
    private readonly fcmChannel:      FcmRepushPanicChannel,
    private readonly whatsappChannel: WhatsAppPanicChannel,
    private readonly smsChannel:      SmsPanicChannel,
    private readonly voiceChannel:    VoicePanicChannel,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== PANIC_ESCALATION_JOBS.ESCALATE) {
      this.logger.warn(`Job desconocido en cola de escalamiento: ${job.name}`);
      return;
    }
    await this.escalate(job as Job<PanicEscalationJobPayload>);
  }

  private async escalate(job: Job<PanicEscalationJobPayload>): Promise<void> {
    const { panicAlertId, level } = job.data;

    const alert = await this.panicRepo.findOne({ where: { id: panicAlertId } });
    if (!alert) {
      this.logger.warn(`Escalamiento abortado: la alerta ${panicAlertId} ya no existe`);
      return;
    }

    // Condición de corte. Se relee el estado en cada nivel porque pudo cambiar
    // mientras el job esperaba en la cola.
    if (this.isClosed(alert)) {
      this.logger.log(
        `Escalamiento nivel ${level} cancelado — alerta ${alert.id} en estado ${alert.status}`,
      );
      return;
    }

    // Nivel 1 solo tiene sentido si nadie confirmó ENTREGA; los niveles 2 y 3 se
    // disparan por falta de RECONOCIMIENTO, así que una alerta entregada pero no
    // atendida sí los ejecuta.
    if (level === 1 && alert.status === PanicAlertStatus.DELIVERED) {
      this.logger.log(
        `Nivel 1 omitido — la alerta ${alert.id} sí fue entregada; se espera al nivel 2`,
      );
      await this.scheduleNext(alert, 2);
      return;
    }

    const settings  = await this.getSettings(alert.complexId);
    const targets   = await this.resolveTargets(alert, level);
    const channels  = this.channelsForLevel(level);

    this.logger.warn(
      `PANIC escalamiento nivel ${level} — alerta ${alert.id}, ` +
      `${targets.length} destinatarios, canales [${channels.map(c => c.channel).join(', ')}]`,
    );

    const ctx: PanicChannelContext = {
      alert,
      userIds:         targets,
      escalationLevel: level,
      title:           'ALERTA DE PÁNICO SIN ATENDER',
      body:            `${alert.triggeredByLabel ?? 'Alerta de pánico'} — nadie la ha atendido.`,
    };

    // allSettled: un canal caído no puede impedir que salgan los demás. Ese es
    // justamente el motivo de tener varios.
    const results = await Promise.allSettled(
      channels.map(async (channel) => {
        const result = channel.isAvailable()
          ? await channel.send(ctx)
          : { reached: 0, skippedReason: channel.unavailableReason() };
        await this.audit(alert, channel, level, result.skippedReason, targets);
        return result;
      }),
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      // No debería ocurrir: el contrato dice que un canal nunca lanza.
      this.logger.error(`Canales que lanzaron en nivel ${level}: ${JSON.stringify(failed)}`);
    }

    await this.panicRepo.update({ id: alert.id }, { escalationLevel: level });

    if (level < 3 && settings.isEnabled) {
      await this.scheduleNext(alert, level + 1);
    }
  }

  // ── Programación ────────────────────────────────────────────────────────────

  /**
   * Encola el siguiente nivel con el retraso restante respecto a la creación de
   * la alerta, no respecto a ahora: si un nivel se ejecutó tarde por congestión
   * de la cola, el siguiente no debe correrse aún más.
   */
  private async scheduleNext(alert: PanicAlert, level: number): Promise<void> {
    const settings = await this.getSettings(alert.complexId);
    if (!settings.isEnabled) return;

    const offsetSeconds =
      level === 1 ? settings.level1DelaySeconds :
      level === 2 ? settings.level2DelaySeconds :
      settings.level3DelaySeconds;

    const elapsedMs = Date.now() - alert.createdAt.getTime();
    const delay     = Math.max(0, offsetSeconds * 1000 - elapsedMs);

    await this.queue.add(
      PANIC_ESCALATION_JOBS.ESCALATE,
      { panicAlertId: alert.id, complexId: alert.complexId, level },
      {
        delay,
        jobId: panicEscalationJobId(alert.id, level),
        attempts: 2,
        backoff: { type: 'fixed', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    );
  }

  // ── Destinatarios ───────────────────────────────────────────────────────────

  private async resolveTargets(alert: PanicAlert, level: number): Promise<string[]> {
    const roles =
      level === 1
        ? [ValidRoles.SECURITY_ROL, ValidRoles.COMPLEX_ROL]
        : level === 2
          ? [ValidRoles.SUPERVISOR_ROL, ValidRoles.COMPLEX_ROL]
          : [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL];

    const ids = await this.notificationsService.findUserIdsByRoleInternal(alert.complexId, roles);
    // Nunca al que activó la alarma: ya sabe que la activó.
    return ids.filter(id => id !== alert.triggeredByUserId);
  }

  /**
   * Canales por nivel. Se sube de intensidad, no se repite lo que ya falló:
   * si el push no llegó en el nivel 1, insistir con push en el 2 no aporta.
   */
  private channelsForLevel(level: number): PanicChannel[] {
    if (level === 1) return [this.fcmChannel, this.socketChannel, this.whatsappChannel];
    if (level === 2) return [this.emailChannel, this.socketChannel, this.smsChannel];
    return [this.emailChannel, this.voiceChannel, this.socketChannel];
  }

  // ── Estado y auditoría ──────────────────────────────────────────────────────

  private isClosed(alert: PanicAlert): boolean {
    return (
      alert.status === PanicAlertStatus.ACKNOWLEDGED ||
      alert.status === PanicAlertStatus.RESOLVED ||
      alert.status === PanicAlertStatus.FALSE_ALARM
    );
  }

  private async audit(
    alert: PanicAlert,
    channel: PanicChannel,
    level: number,
    failureReason: string | undefined,
    targets: string[],
  ): Promise<void> {
    try {
      await this.deliveryRepo.save(
        this.deliveryRepo.create({
          panicAlertId:    alert.id,
          channel:         channel.channel,
          escalationLevel: level,
          failureReason,
          // SOCKET no tiene destinatario individual: va a la sala del complejo.
          userId: channel.channel === PanicDeliveryChannel.SOCKET ? undefined : targets[0],
        }),
      );
    } catch (err) {
      // La auditoría nunca puede tumbar el escalamiento.
      this.logger.warn(`No se pudo auditar el envío por ${channel.channel}: ${(err as Error)?.message}`);
    }
  }

  /** Devuelve la configuración del complejo, o los valores por defecto si no la tiene. */
  private async getSettings(complexId: string): Promise<PanicEscalationSettings> {
    const found = await this.settingsRepo.findOne({ where: { complexId } });
    if (found) return found;

    // Sin fila configurada se usan los defaults en memoria: crear la fila aquí
    // provocaría escrituras concurrentes desde varios niveles a la vez.
    return this.settingsRepo.create({
      complexId,
      isEnabled:          true,
      level1DelaySeconds: 15,
      level2DelaySeconds: 45,
      level3DelaySeconds: 90,
    });
  }
}
