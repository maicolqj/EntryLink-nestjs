import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MarketplaceListingsService } from '../services/marketplace-listings.service';

/**
 * Vigencia de los avisos.
 *
 * Sin esto la vitrina se pudre: a los tres meses es un cementerio de cosas ya
 * vendidas y el vecino deja de entrar. El aviso de "está por vencer" llega
 * antes con el botón de renovar, así que lo que cae es lo que su dueño
 * abandonó, no lo que sigue disponible.
 */
@Injectable()
export class MarketplaceCron {
  private readonly logger = new Logger(MarketplaceCron.name);

  constructor(private readonly listingsService: MarketplaceListingsService) {}

  /**
   * Una vez al día a las 7 a.m. Son vencimientos en días: revisar más seguido
   * solo gasta consultas, y nadie necesita el aviso de madrugada.
   *
   * El orden importa: primero se avisa de lo que está por vencer y después se
   * vence lo cumplido. Al revés, un aviso podría caducar el mismo día en que se
   * le avisa a su dueño que le quedaban horas.
   */
  @Cron('0 7 * * *', { timeZone: 'America/Bogota' })
  async handleExpiries(): Promise<void> {
    try {
      const warned = await this.listingsService.notifyExpiringSoon();
      if (warned > 0) {
        this.logger.log(`Avisos de vencimiento de clasificados: ${warned}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error al avisar vencimientos de clasificados: ${error.message}`,
        error.stack,
      );
    }

    try {
      const expired = await this.listingsService.expireOverdue();
      if (expired > 0) {
        this.logger.log(`Publicaciones vencidas: ${expired}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error al vencer publicaciones: ${error.message}`,
        error.stack,
      );
    }
  }
}
