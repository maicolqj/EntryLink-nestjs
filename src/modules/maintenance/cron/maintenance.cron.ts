import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceTicketsService } from '../services/maintenance-tickets.service';

/**
 * Lo que el tablero no hace solo: marcar lo vencido, cerrar lo que ya nadie va
 * a confirmar y pedir la calificación una vez.
 */
@Injectable()
export class MaintenanceCron {
  private readonly logger = new Logger(MaintenanceCron.name);

  constructor(private readonly ticketsService: MaintenanceTicketsService) {}

  /**
   * Cada hora. Los plazos se miden en horas —cuatro para un escape de gas— y
   * revisar una vez al día dejaría el aviso de incumplimiento llegando cuando
   * ya no sirve de nada.
   */
  @Cron('0 * * * *', { timeZone: 'America/Bogota' })
  async flagOverdueTickets(): Promise<void> {
    try {
      const marked = await this.ticketsService.breachOverdueTickets();
      if (marked > 0) {
        this.logger.log(`Tickets de mantenimiento vencidos: ${marked}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error al revisar plazos de mantenimiento: ${error.message}`,
        error.stack,
      );
    }
  }

  /** Una vez al día. Son días de espera: revisar más seguido no cambia nada. */
  @Cron('30 7 * * *', { timeZone: 'America/Bogota' })
  async autoCloseTickets(): Promise<void> {
    try {
      const closed = await this.ticketsService.autoCloseResolvedTickets();
      if (closed > 0) {
        this.logger.log(`Tickets cerrados automáticamente: ${closed}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error en el autocierre de mantenimiento: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * A las 9 a.m., no de madrugada: es un recordatorio amable, no una alerta.
   * Se manda una sola vez —la ventana de dos días lo garantiza—, porque
   * insistir en que califiquen es la forma más rápida de que apaguen los avisos.
   */
  @Cron('0 9 * * *', { timeZone: 'America/Bogota' })
  async remindRatings(): Promise<void> {
    try {
      const sent = await this.ticketsService.remindPendingRatings();
      if (sent > 0) {
        this.logger.log(`Recordatorios de calificación enviados: ${sent}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error al recordar calificaciones: ${error.message}`,
        error.stack,
      );
    }
  }
}
