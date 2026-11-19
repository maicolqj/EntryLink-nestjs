import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MailerService } from '@nestjs-modules/mailer';
import { Job } from 'bullmq';
import { Readable } from 'node:stream';
import {
  MAIL_QUEUE_NAME,
  MAIL_JOBS,
  SendPasswordResetJobPayload,
  SendEmailVerificationJobPayload,
  SendPanicAlertJobPayload,
  SendSubscriptionNoticeJobPayload,
  SendPlatformAnnouncementJobPayload,
} from './constants/mail.constants';
import { R2StorageService } from '../core/infrastructure/r2/r2.service';

/**
 * Worker que procesa los jobs de envío de correos electrónicos.
 *
 * En producción este procesador envía correos reales vía el proveedor SMTP configurado.
 * En desarrollo, Nodemailer + Ethereal o MailHog capturan los correos localmente.
 */
@Processor(MAIL_QUEUE_NAME)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly storageService: R2StorageService,
  ) {
    super();
  }

  /**
   * Sin esto un fallo SMTP no deja rastro en consola: solo se ve
   * "Procesando envío..." repetido y el motivo queda guardado en Redis.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    const attempts = job?.opts.attempts ?? 1;
    const made = job?.attemptsMade ?? 0;
    const code = (error as Error & { code?: string }).code;

    this.logger.error(
      `Fallo al enviar correo [${job?.name ?? 'desconocido'}] — intento ${made}/${attempts}` +
        `${code ? ` | ${code}` : ''} | ${error.message}`,
    );

    // Solo el último intento: los anteriores se reintentan solos. Sin el
    // destinatario (dato personal), solo el tipo de correo.
    if (made >= attempts) {
      Sentry.withScope((scope) => {
        scope.setTag('queue', MAIL_QUEUE_NAME);
        scope.setTag('mailJob', job?.name ?? 'desconocido');
        if (code) scope.setTag('smtpCode', code);
        Sentry.captureException(error);
      });
    }
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case MAIL_JOBS.SEND_PASSWORD_RESET:
        await this.handlePasswordReset(job as Job<SendPasswordResetJobPayload>);
        break;
      case MAIL_JOBS.SEND_EMAIL_VERIFICATION:
        await this.handleEmailVerification(
          job as Job<SendEmailVerificationJobPayload>,
        );
        break;
      case MAIL_JOBS.SEND_PANIC_ALERT:
        await this.handlePanicAlert(job as Job<SendPanicAlertJobPayload>);
        break;
      case MAIL_JOBS.SEND_SUBSCRIPTION_NOTICE:
        await this.handleSubscriptionNotice(
          job as Job<SendSubscriptionNoticeJobPayload>,
        );
        break;
      case MAIL_JOBS.SEND_PLATFORM_ANNOUNCEMENT:
        await this.handlePlatformAnnouncement(
          job as Job<SendPlatformAnnouncementJobPayload>,
        );
        break;
      default:
        this.logger.warn(`Job desconocido en cola mail: ${job.name}`);
    }
  }

  private async handlePlatformAnnouncement(
    job: Job<SendPlatformAnnouncementJobPayload>,
  ): Promise<void> {
    const d = job.data;

    const attachments = await Promise.all(
      d.attachments.map(async (a) => {
        const file = await this.storageService.getObjectStream(a.key);
        return {
          filename: a.name,
          content: await streamToBuffer(file.stream),
          contentType: a.mimeType,
        };
      }),
    );

    await this.mailerService.sendMail({
      to: d.email,
      subject: `${d.title} — EntryLink`,
      template: 'platform-announcement',
      context: {
        title: d.title,
        categoryLabel: d.categoryLabel,
        complexName: d.complexName,
        body: d.body,
        imageUrls: d.imageUrls,
        attachmentNames: d.attachments.map((a) => a.name),
        hasAttachments: d.attachments.length > 0,
        year: new Date().getFullYear(),
      },
      attachments,
    });

    this.logger.log(
      `Comunicado ${d.announcementId} enviado por correo al complejo ${d.complexId}`,
    );
  }

  private async handleSubscriptionNotice(
    job: Job<SendSubscriptionNoticeJobPayload>,
  ): Promise<void> {
    const d = job.data;

    await this.mailerService.sendMail({
      to: d.email,
      subject: `${d.title} — ${d.complexName}`,
      template: 'subscription-notice',
      context: {
        complexName: d.complexName,
        title: d.title,
        message: d.message,
        note: d.note,
        ctaUrl: d.ctaUrl,
        headerColor: d.tone === 'danger' ? '#b00020' : '#b45309',
        year: new Date().getFullYear(),
      },
    });

    this.logger.log(`Aviso de suscripción enviado al complejo ${d.complexId}`);
  }

  private async handlePanicAlert(
    job: Job<SendPanicAlertJobPayload>,
  ): Promise<void> {
    const d = job.data;

    this.logger.warn(
      `Procesando correo de pánico — alerta ${d.alertId}, nivel ${d.escalationLevel}`,
    );

    await this.mailerService.sendMail({
      to: d.email,
      // El asunto lleva el dato accionable delante: en la lista del cliente de
      // correo suele verse solo el principio.
      subject: `ALERTA DE PÁNICO — ${d.triggeredByLabel}`,
      template: 'panic-alert',
      context: {
        name: d.name,
        triggeredByLabel: d.triggeredByLabel,
        triggeredAt: d.triggeredAt,
        escalationLevel: d.escalationLevel,
        locationUrl: d.locationUrl,
        year: new Date().getFullYear(),
      },
    });

    this.logger.warn(`Correo de pánico enviado — alerta ${d.alertId}`);
  }

  private async handlePasswordReset(
    job: Job<SendPasswordResetJobPayload>,
  ): Promise<void> {
    const { email, name, resetUrl, expiresInMinutes, userId } = job.data;

    this.logger.log(`Procesando envío de email de reset — userId: ${userId}`);

    await this.mailerService.sendMail({
      to: email,
      subject: 'Restablece tu contraseña — EntryLink',
      template: 'password-reset',
      context: {
        name,
        resetUrl,
        expiresInMinutes,
        year: new Date().getFullYear(),
      },
    });

    this.logger.log(
      `Email de reset enviado a ${email.replace(/(.{2}).+(@.+)/, '$1***$2')}`,
    );
  }

  private async handleEmailVerification(
    job: Job<SendEmailVerificationJobPayload>,
  ): Promise<void> {
    const { email, name, verificationUrl, expiresInMinutes, userId } = job.data;

    this.logger.log(
      `Procesando envío de email de verificación — userId: ${userId}`,
    );

    await this.mailerService.sendMail({
      to: email,
      subject: 'Verifica tu correo electrónico — EntryLink',
      template: 'email-verification',
      context: {
        name,
        verificationUrl,
        expiresInMinutes,
        year: new Date().getFullYear(),
      },
    });

    this.logger.log(
      `Email de verificación enviado a ${email.replace(/(.{2}).+(@.+)/, '$1***$2')}`,
    );
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
