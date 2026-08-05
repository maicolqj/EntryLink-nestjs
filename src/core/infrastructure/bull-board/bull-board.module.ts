import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { OTP_QUEUE_NAME } from '../../../modules/auth/queues/otp.queue.constants';
import { MAIL_QUEUE_NAME } from '../../../mail/constants/mail.constants';
import { PANIC_ESCALATION_QUEUE } from '../../../modules/notifications/queues/panic-escalation.queue.constants';
import { bullBoardAuthMiddleware } from './bull-board-auth.middleware';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/bull-board',
      adapter: ExpressAdapter,
      middleware: bullBoardAuthMiddleware,
    }),

    BullModule.registerQueue(
      { name: OTP_QUEUE_NAME },
      { name: MAIL_QUEUE_NAME },
      { name: PANIC_ESCALATION_QUEUE },
    ),

    BullBoardModule.forFeature(
      { name: OTP_QUEUE_NAME,  adapter: BullMQAdapter },
      { name: MAIL_QUEUE_NAME, adapter: BullMQAdapter },
      // Sin esta línea el panel no muestra el escalamiento de pánico, que es la
      // única forma de ver si los jobs L1/L2/L3 se encolaron a los 15/45/90s y si
      // se cancelaron al reconocer la alerta. El resto del circuito no deja
      // rastro visible: la cola es donde se comprueba.
      { name: PANIC_ESCALATION_QUEUE, adapter: BullMQAdapter },
    ),
  ],
})
export class BullBoardAppModule {}
