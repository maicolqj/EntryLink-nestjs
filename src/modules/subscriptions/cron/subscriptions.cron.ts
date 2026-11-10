import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SubscriptionRemindersService } from '../services/subscription-reminders.service';
import { SubscriptionCutService } from '../services/subscription-cut.service';

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
    private readonly cutService: SubscriptionCutService,
  ) {}

  /** Sale apagado: solo actúa según SUBSCRIPTION_CUT_MODE. */
  @Cron('0 8 * * *', { timeZone: 'America/Bogota' })
  async handleCut(): Promise<void> {
    try {
      const advanced = await this.cutService.run();
      if (advanced > 0) {
        this.logger.log(`Conjuntos que avanzaron hacia el corte: ${advanced}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error al procesar el corte de suscripción: ${error.message}`,
        error.stack,
      );
    }
  }

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
