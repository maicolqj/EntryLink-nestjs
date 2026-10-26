import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlatformAnnouncement } from './entities/platform-announcement.entity';
import { PlatformAnnouncementsService } from './services/platform-announcements.service';
import { PlatformAnnouncementsResolver } from './resolvers/platform-announcements.resolver';
import { PlatformAnnouncementsController } from './controllers/platform-announcements.controller';
import { PlatformAnnouncementNotificationDetailProvider } from './providers/platform-announcement-notification-detail.provider';

import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { Resident } from '../residents/entities/resident.entity';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Comunicados de la plataforma a los conjuntos: novedades, promociones y
 * noticias que envían SUPER_ADMIN y el oficial de cumplimiento, a la
 * administración, a los residentes o a ambos.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformAnnouncement,
      ResidentialComplex, // segmentación por plan, estado y vinculación
      Resident, // residentes activos de cada conjunto
    ]),
    NotificationsModule, // reparto y detalle del aviso
  ],
  controllers: [PlatformAnnouncementsController],
  providers: [
    PlatformAnnouncementsService,
    PlatformAnnouncementsResolver,
    PlatformAnnouncementNotificationDetailProvider,
  ],
})
export class PlatformAnnouncementsModule {}
