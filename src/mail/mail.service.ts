import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MAIL_QUEUE_NAME,
  MAIL_JOBS,
  SendPasswordResetJobPayload,
  SendEmailVerificationJobPayload,
  SendPanicAlertJobPayload,
} from './constants/mail.constants';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE_NAME) private readonly mailQueue: Queue,
  ) {}

  async queuePasswordResetEmail(payload: SendPasswordResetJobPayload): Promise<void> {
    await this.mailQueue.add(MAIL_JOBS.SEND_PASSWORD_RESET, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(`Password reset email job enqueued for userId: ${payload.userId}`);
  }

  async queueEmailVerificationEmail(payload: SendEmailVerificationJobPayload): Promise<void> {
    await this.mailQueue.add(MAIL_JOBS.SEND_EMAIL_VERIFICATION, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(`Email verification job enqueued for userId: ${payload.userId}`);
  }

  /**
   * Encola el correo de escalamiento de un pánico.
   *
   * Prioridad máxima y sin backoff exponencial largo: si este correo llega tarde
   * ya no sirve de nada. Se reintenta rápido y pocas veces.
   */
  async queuePanicAlertEmail(payload: SendPanicAlertJobPayload): Promise<void> {
    await this.mailQueue.add(MAIL_JOBS.SEND_PANIC_ALERT, payload, {
      priority: 1,
      attempts: 2,
      backoff: { type: 'fixed', delay: 3_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    });

    this.logger.log(`Panic alert email job enqueued for alert: ${payload.alertId}`);
  }
}
