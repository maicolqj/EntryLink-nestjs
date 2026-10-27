import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlatformAnnouncement } from './entities/platform-announcement.entity';
import { PlatformAnnouncementUserState } from './entities/platform-announcement-user-state.entity';
import { PlatformAnnouncementsTrashCron } from './cron/platform-announcements-trash.cron';
import { PlatformAnnouncementsService } from './services/platform-announcements.service';
import { PlatformAnnouncementsResolver } from './resolvers/platform-announcements.resolver';
import { PlatformAnnouncementsController } from './controllers/platform-announcements.controller';
import { PlatformAnnouncementNotificationDetailProvider } from './providers/platform-announcement-notification-detail.provider';

import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { Resident } from '../residents/entities/resident.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Comunicados de la plataforma a los conjuntos: novedades, promociones y
 * noticias que envían SUPER_ADMIN y el oficial de cumplimiento, como aviso (a
 * la administración, a los residentes o a ambos) y/o por correo al email
 * registrado del conjunto, con archivos adjuntos. MailService llega por el
 * MailModule global.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformAnnouncement,
      PlatformAnnouncementUserState, // destacado/archivado de cada quien
      ResidentialComplex, // segmentación por plan, estado y vinculación
      Resident, // residentes activos de cada conjunto
      Notification, // quién recibió el comunicado (descarga de adjuntos)
    ]),
    NotificationsModule, // reparto y detalle del aviso
  ],
  controllers: [PlatformAnnouncementsController],
  providers: [
    PlatformAnnouncementsService,
    PlatformAnnouncementsResolver,
    PlatformAnnouncementNotificationDetailProvider,
    PlatformAnnouncementsTrashCron,
  ],
})
export class PlatformAnnouncementsModule {}
