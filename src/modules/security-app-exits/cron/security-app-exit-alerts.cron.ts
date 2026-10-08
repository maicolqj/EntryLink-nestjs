import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { SecurityAppExitsService } from '../services/security-app-exits.service';

/**
 * Avisa a la administración de los vigilantes que llevan fuera de la app más
 * minutos de los que permite su conjunto.
 *
 * Corre cada minuto en vez de programar un trabajo por salida: sobrevive a un
 * reinicio del servidor, y si el conjunto cambia el margen se aplica a las
 * salidas que ya estaban abiertas. El aviso inmediato (0 minutos) no espera al
 * cron, lo manda la mutación.
 */
@Injectable()
export class SecurityAppExitAlertsCron {
  private readonly logger = new Logger(SecurityAppExitAlertsCron.name);

  constructor(private readonly exitsService: SecurityAppExitsService) {}

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    const due = await this.exitsService.findDueAlerts();
    if (!due.length) return;

    const sent = await this.exitsService.sendAlerts(due);
    this.logger.log(`Avisos de vigilantes fuera de la app: ${sent}`);
  }
}
