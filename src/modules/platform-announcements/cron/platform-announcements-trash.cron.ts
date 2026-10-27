import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PlatformAnnouncementsService } from '../services/platform-announcements.service';

/**
 * Vacía la papelera de comunicados: lo que lleva más de 30 días allí se
 * elimina del todo, con sus imágenes y adjuntos en R2.
 */
@Injectable()
export class PlatformAnnouncementsTrashCron {
  private readonly logger = new Logger(PlatformAnnouncementsTrashCron.name);

  constructor(
    private readonly announcementsService: PlatformAnnouncementsService,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'America/Bogota' })
  async sweep(): Promise<void> {
    try {
      const purged = await this.announcementsService.purgeExpiredTrash();
      if (purged > 0) {
        this.logger.log(`Comunicados eliminados de la papelera: ${purged}`);
      }
    } catch (err) {
      this.logger.error(
        `Error al vaciar la papelera de comunicados: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
