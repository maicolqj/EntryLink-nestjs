import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Notification } from './entities/notification.entity';

import { NotificationsService }  from './services/notifications.service';
import { NotificationsResolver } from './resolvers/notifications.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
  ],
  providers: [
    NotificationsService,
    NotificationsResolver,
  ],
  exports: [
    /**
     * Exportamos el servicio para que cualquier módulo del sistema
     * pueda crear notificaciones llamando a NotificationsService.create().
     *
     * Ejemplo en PackagesService:
     *   this.notificationsService.create({
     *     type: NotificationType.PACKAGE_RECEIVED,
     *     title: 'Tienes un paquete',
     *     body: `Llegó un paquete de ${input.senderName}`,
     *     complexId: input.complexId,
     *     recipientUserId: resident.userId,
     *     entityId: pkg.id,
     *     entityType: 'package',
     *   });
     */
    NotificationsService,
  ],
})
export class NotificationsModule {}
