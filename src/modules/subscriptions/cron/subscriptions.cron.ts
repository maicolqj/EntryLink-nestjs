import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SubscriptionRemindersService } from '../services/subscription-reminders.service';

/**
 * Avisos de vencimiento de la suscripción, una vez al día a las 8 a. m.
 *
 * Son plazos en días: revisar más seguido solo gasta consultas, y nadie
 * necesita un aviso de cobro de madrugada. La suspensión no la ejecuta este
 * cron: el estado se calcula al vuelo con la fecha de vencimiento, así que el
 * bloqueo llega a tiempo aunque el cron no corra.
 */
@Injectable()
export class SubscriptionsCron {
  private readonly logger = new Logger(SubscriptionsCron.name);

  constructor(
    private readonly remindersService: SubscriptionRemindersService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'America/Bogota' })
  async handleReminders(): Promise<void> {
    try {
      const sent = await this.remindersService.sendDueReminders();
      if (sent > 0) {
        this.logger.log(`Avisos de suscripción enviados: ${sent}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error al enviar avisos de suscripción: ${error.message}`,
        error.stack,
      );
    }
  }
}
