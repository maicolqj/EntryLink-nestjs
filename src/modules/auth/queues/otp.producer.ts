import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OTP_QUEUE_NAME, OTP_JOBS, SendOtpJobPayload, SendSystemCodeJobPayload } from './otp.queue.constants';

@Injectable()
export class OtpProducer {
  private readonly logger = new Logger(OtpProducer.name);

  constructor(
    @InjectQueue(OTP_QUEUE_NAME) private readonly otpQueue: Queue,
  ) {}

  async sendOtp(payload: SendOtpJobPayload): Promise<void> {
    await this.otpQueue.add(OTP_JOBS.SEND_OTP, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(`OTP job enqueued for phone: ${payload.phoneNumber.replace(/\d{6}$/, '******')}`);
  }

  async sendSystemCode(payload: SendSystemCodeJobPayload): Promise<void> {
    await this.otpQueue.add(OTP_JOBS.SEND_SYSTEM_CODE, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(`System-code job enqueued for phone: ${payload.phoneNumber.replace(/\d{6}$/, '******')}`);
  }
}
