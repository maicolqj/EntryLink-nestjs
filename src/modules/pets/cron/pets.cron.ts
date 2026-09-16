import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PetsService } from '../services/pets.service';

/**
 * Avisos de vencimiento de la vacuna antirrábica y de la póliza de RC
 * extracontractual de las razas de manejo especial.
 *
 * Existe porque nadie recuerda la fecha del refuerzo de su perro, y una póliza
 * vencida deja a la copropiedad respondiendo por lo que pase. El aviso llega
 * antes de que sea un problema, no después.
 */
@Injectable()
export class PetsCron {
  private readonly logger = new Logger(PetsCron.name);

  constructor(private readonly petsService: PetsService) {}

  /**
   * Una vez al día a las 8 a.m. Son vencimientos en días: revisar más seguido
   * solo gasta consultas, y el residente no necesita el aviso de madrugada.
   */
  @Cron('0 8 * * *', { timeZone: 'America/Bogota' })
  async notifyExpiringDocuments(): Promise<void> {
    try {
      const sent = await this.petsService.notifyExpiringDocuments();
      if (sent > 0) {
        this.logger.log(`Avisos de vencimiento de mascotas enviados: ${sent}`);
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Error al revisar vencimientos de mascotas: ${error.message}`,
        error.stack,
      );
    }
  }
}
