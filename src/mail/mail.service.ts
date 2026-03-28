import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MAIL_QUEUE_NAME,
  MAIL_JOBS,
  SendPasswordResetJobPayload,
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
}
