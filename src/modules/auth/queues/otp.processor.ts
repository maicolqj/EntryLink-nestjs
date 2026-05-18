import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OTP_QUEUE_NAME, OTP_JOBS, SendOtpJobPayload } from './otp.queue.constants';

/**
 * Worker que procesa los jobs de envío de OTP.
 *
 * En producción este procesador debe integrarse con un proveedor de SMS
 * (Twilio, AWS SNS, Infobip, etc.).
 * Por ahora registra el código en logs para entornos de desarrollo/test.
 */
@Processor(OTP_QUEUE_NAME)
export class OtpProcessor extends WorkerHost {
  private readonly logger = new Logger(OtpProcessor.name);

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case OTP_JOBS.SEND_OTP:
        await this.handleSendOtp(job as Job<SendOtpJobPayload>);
        break;
      default:
        this.logger.warn(`Job desconocido en cola OTP: ${job.name}`);
    }
  }

  private async handleSendOtp(job: Job<SendOtpJobPayload>): Promise<void> {
    const { phoneNumber, code, expiresInMinutes, userId } = job.data;

    this.logger.log(`Procesando envío OTP — userId: ${userId}`);

    // ──────────────────────────────────────────────────────────────────────
    // TODO: Integrar con proveedor SMS en producción.
    // Ejemplo con Twilio:
    //   await this.twilioClient.messages.create({
    //     body: `Tu código de verificación entrylink es: ${code}. Válido por ${expiresInMinutes} minutos.`,
    //     from: process.env.TWILIO_PHONE,
    //     to: `+57${phoneNumber}`,
    //   });
    // ──────────────────────────────────────────────────────────────────────

    // En desarrollo, imprimimos el código en consola
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        `[DEV] SMS → +57${phoneNumber} | Código OTP: ${code} | Válido: ${expiresInMinutes} min`,
      );
    } else {
      this.logger.log(`SMS enviado a +57${phoneNumber.replace(/\d{6}$/, '******')}`);
    }
  }
}
