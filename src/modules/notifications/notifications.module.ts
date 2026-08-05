import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { Notification }         from './entities/notification.entity';
import { PushSubscription }      from './entities/push-subscription.entity';
import { NotificationBatch }     from './entities/notification-batch.entity';
import { PanicAlert }             from './entities/panic-alert.entity';
import { PanicAlertDelivery }      from './entities/panic-alert-delivery.entity';
import { PanicEscalationSettings } from './entities/panic-escalation-settings.entity';

import { User }     from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user_has_roles.entity';
import { Role }     from '../roles/entities/role.entity';
import { ResidentsModule }       from '../residents/residents.module';

import { NotificationsService }  from './services/notifications.service';
import { NotificationsResolver } from './resolvers/notifications.resolver';
import { PanicEscalationProcessor } from './queues/panic-escalation.processor';
import { PANIC_ESCALATION_QUEUE }   from './queues/panic-escalation.queue.constants';
import { SocketPanicChannel }       from './channels/socket-panic.channel';
import { EmailPanicChannel }        from './channels/email-panic.channel';
import { FcmRepushPanicChannel }    from './channels/fcm-repush.channel';
import {
  WhatsAppPanicChannel,
  SmsPanicChannel,
  VoicePanicChannel,
} from './channels/unavailable-panic.channels';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => ResidentsModule),
    BullModule.registerQueue({ name: PANIC_ESCALATION_QUEUE }),
    TypeOrmModule.forFeature([
      Notification,
      PushSubscription,
      NotificationBatch,
      PanicAlert,
      PanicAlertDelivery,
      PanicEscalationSettings,
      // Para resolver destinatarios por rol en sendNotification
      User,
      UserRole,
      Role,
    ]),
  ],
  providers: [
    NotificationsService,
    NotificationsResolver,
    PanicEscalationProcessor,
    // Canales de escalamiento. Los tres últimos declaran su indisponibilidad en
    // vez de omitirse, para que el hueco quede en la auditoría.
    SocketPanicChannel,
    EmailPanicChannel,
    FcmRepushPanicChannel,
    WhatsAppPanicChannel,
    SmsPanicChannel,
    VoicePanicChannel,
  ],
  exports: [
    /**
     * Exportamos el servicio para que cualquier módulo del sistema
     * pueda crear notificaciones llamando a NotificationsService.create()
     * o NotificationsService.notify() (con push incluido).
     */
    NotificationsService,
  ],
})
export class NotificationsModule {}
