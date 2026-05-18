import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Notification }         from './entities/notification.entity';
import { PushSubscription }      from './entities/push-subscription.entity';
import { NotificationBatch }     from './entities/notification-batch.entity';

import { User }     from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user_has_roles.entity';
import { Role }     from '../roles/entities/role.entity';
import { ResidentsModule }       from '../residents/residents.module';

import { NotificationsService }  from './services/notifications.service';
import { NotificationsResolver } from './resolvers/notifications.resolver';

@Module({
  imports: [
    ConfigModule,
    ResidentsModule,
    TypeOrmModule.forFeature([
      Notification,
      PushSubscription,
      NotificationBatch,
      // Para resolver destinatarios por rol en sendNotification
      User,
      UserRole,
      Role,
    ]),
  ],
  providers: [
    NotificationsService,
    NotificationsResolver,
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
