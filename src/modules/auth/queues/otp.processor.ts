import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OTP_QUEUE_NAME, OTP_JOBS, SendOtpJobPayload, SendSystemCodeJobPayload } from './otp.queue.constants';
import { WhatsAppService } from '../services/whatsapp.service';

/**
 * Worker que procesa los jobs de envío de códigos de autenticación.
 *
 * El canal de envío es WhatsApp Cloud API (Meta). Si el servicio no está
 * configurado (entornos dev/test sin credenciales), el código se imprime
 * en logs; en producción sin configuración el job falla para que quede
 * visible en Bull Board.
 */
@Processor(OTP_QUEUE_NAME)
export class OtpProcessor extends WorkerHost {
  private readonly logger = new Logger(OtpProcessor.name);

  constructor(private readonly whatsAppService: WhatsAppService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case OTP_JOBS.SEND_OTP:
        await this.handleSendOtp(job as Job<SendOtpJobPayload>);
        break;
      case OTP_JOBS.SEND_SYSTEM_CODE:
        await this.handleSendSystemCode(job as Job<SendSystemCodeJobPayload>);
        break;
      default:
        this.logger.warn(`Job desconocido en cola OTP: ${job.name}`);
    }
  }

  private async handleSendOtp(job: Job<SendOtpJobPayload>): Promise<void> {
    const { phoneNumber, code, expiresInMinutes, userId } = job.data;

    this.logger.log(`Procesando envío OTP — userId: ${userId}`);

    if (!this.assertChannelAvailable('OTP', phoneNumber, code)) return;

    await this.whatsAppService.sendOtp(phoneNumber, code);
    this.logger.log(`OTP enviado por WhatsApp (válido ${expiresInMinutes} min) — userId: ${userId}`);
  }

  private async handleSendSystemCode(job: Job<SendSystemCodeJobPayload>): Promise<void> {
    const { phoneNumber, systemCode, userId } = job.data;

    this.logger.log(`Procesando reenvío de código de sistema — userId: ${userId}`);

    if (!this.assertChannelAvailable('SystemCode', phoneNumber, systemCode)) return;

    await this.whatsAppService.sendSystemCode(phoneNumber, systemCode);
    this.logger.log(`Código de sistema enviado por WhatsApp — userId: ${userId}`);
  }

  /**
   * Devuelve true si WhatsApp está configurado. Si no:
   * - en dev/test imprime el código en logs y da el job por completado;
   * - en producción lanza para que el fallo quede registrado y se reintente.
   */
  private assertChannelAvailable(kind: string, phoneNumber: string, code: string): boolean {
    if (this.whatsAppService.isEnabled) return true;

    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[DEV] WhatsApp ${kind} → +57${phoneNumber} | Código: ${code}`);
      return false;
    }

    throw new Error(`WhatsApp Cloud API no configurado: imposible enviar ${kind} en producción`);
  }
}
