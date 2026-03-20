import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { OTP_QUEUE_NAME } from '../../../modules/auth/queues/otp.queue.constants';
import { MAIL_QUEUE_NAME } from '../../../mail/constants/mail.constants';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/bull-board',
      adapter: ExpressAdapter,
    }),

    BullModule.registerQueue(
      { name: OTP_QUEUE_NAME },
      { name: MAIL_QUEUE_NAME },
    ),

    BullBoardModule.forFeature(
      { name: OTP_QUEUE_NAME,  adapter: BullMQAdapter },
      { name: MAIL_QUEUE_NAME, adapter: BullMQAdapter },
    ),
  ],
})
export class BullBoardAppModule {}
