import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { Job } from 'bullmq';
import {
  MAIL_QUEUE_NAME,
  MAIL_JOBS,
  SendPasswordResetJobPayload,
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
      default:
        this.logger.warn(`Job desconocido en cola mail: ${job.name}`);
    }
  }

  private async handlePasswordReset(job: Job<SendPasswordResetJobPayload>): Promise<void> {
    const { email, name, resetUrl, expiresInMinutes, userId } = job.data;

    this.logger.log(`Procesando envío de email de reset — userId: ${userId}`);

    await this.mailerService.sendMail({
      to: email,
      subject: 'Restablece tu contraseña — Residash',
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
}
