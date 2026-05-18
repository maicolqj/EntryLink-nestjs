import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { Job } from 'bullmq';
import {
  MAIL_QUEUE_NAME,
  MAIL_JOBS,
  SendPasswordResetJobPayload,
  SendEmailVerificationJobPayload,
} from './constants/mail.constants';

/**
 * Worker que procesa los jobs de envío de correos electrónicos.
 *
 * En producción este procesador envía correos reales vía el proveedor SMTP configurado.
 * En desarrollo, Nodemailer + Ethereal o MailHog capturan los correos localmente.
 */
@Processor(MAIL_QUEUE_NAME)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailerService: MailerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case MAIL_JOBS.SEND_PASSWORD_RESET:
        await this.handlePasswordReset(job as Job<SendPasswordResetJobPayload>);
        break;
      case MAIL_JOBS.SEND_EMAIL_VERIFICATION:
        await this.handleEmailVerification(job as Job<SendEmailVerificationJobPayload>);
        break;
      default:
        this.logger.warn(`Job desconocido en cola mail: ${job.name}`);
    }
  }

  private async handlePasswordReset(job: Job<SendPasswordResetJobPayload>): Promise<void> {
    const { email, name, resetUrl, expiresInMinutes, userId } = job.data;

    this.logger.log(`Procesando envío de email de reset — userId: ${userId}`);

    await this.mailerService.sendMail({
      to: email,
      subject: 'Restablece tu contraseña — entrylink',
      template: 'password-reset',
      context: {
        name,
        resetUrl,
        expiresInMinutes,
        year: new Date().getFullYear(),
      },
    });

    this.logger.log(`Email de reset enviado a ${email.replace(/(.{2}).+(@.+)/, '$1***$2')}`);
  }

  private async handleEmailVerification(job: Job<SendEmailVerificationJobPayload>): Promise<void> {
    const { email, name, verificationUrl, expiresInMinutes, userId } = job.data;

    this.logger.log(`Procesando envío de email de verificación — userId: ${userId}`);

    await this.mailerService.sendMail({
      to: email,
      subject: 'Verifica tu correo electrónico — entrylink',
      template: 'email-verification',
      context: {
        name,
        verificationUrl,
        expiresInMinutes,
        year: new Date().getFullYear(),
      },
    });

    this.logger.log(`Email de verificación enviado a ${email.replace(/(.{2}).+(@.+)/, '$1***$2')}`);
  }
}
