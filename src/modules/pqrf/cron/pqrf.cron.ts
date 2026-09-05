import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PqrfService } from '../services/pqrf.service';

/**
 * Vigilancia de los plazos de los radicados.
 *
 * Sin esto un PQRF puede quedarse abierto para siempre: basta con que nadie lo
 * atienda. El barrido insiste antes de que se venza y, cuando el plazo pasa, lo
 * resuelve a favor de quien radicó —el silencio administrativo positivo—.
 */
@Injectable()
export class PqrfCron implements OnModuleInit {
  private readonly logger = new Logger(PqrfCron.name);

  constructor(private readonly pqrfService: PqrfService) {}

  /**
   * Un barrido al arrancar, sin bloquear el arranque.
   *
   * Los plazos siguen corriendo mientras el servidor está caído: si un radicado
   * se venció durante un despliegue, esperar a la hora en punto lo dejaría
   * abierto sin razón. También recoge lo que quedó cerrado a medias por un
   * cambio en las reglas de quién debe responder.
   */
  onModuleInit(): void {
    void this.sweep();
  }

  /**
   * Cada hora. El plazo se cuenta en días, así que revisar más seguido solo
   * gasta consultas, y menos seguido correría el vencimiento hasta medio día.
   */
  @Cron('0 * * * *', { timeZone: 'America/Bogota' })
  async sweep(): Promise<void> {
    try {
      // El orden importa. Primero se cierra lo que ya respondieron todos —el
      // cierre no siempre coincide con el último clic—, después se vence lo que
      // ya no tiene remedio, y de último se recuerda lo que aún se puede
      // salvar: al revés se le insistiría a alguien por un radicado que en la
      // misma pasada acaba de cerrarse o de vencerse.
      const closed = await this.pqrfService.closeFullyAnswered();
      const expired = await this.pqrfService.resolveExpiredBySilence();
      const reminded = await this.pqrfService.sendDueReminders();

      if (closed || expired || reminded) {
        this.logger.log(
          `Barrido de PQRF — ${closed} cerrados, ${expired} resueltos por silencio, ${reminded} recordatorios`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Error en el barrido de PQRF: ${err?.message}`, err?.stack);
    }
  }
}
