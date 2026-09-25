import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { VehiclesService } from '../services/vehicles.service';

/**
 * Cron diario a las 06:00 AM (Bogotá) que ejecuta las rotaciones de
 * parqueadero que ya tocan.
 *
 * Antes la rotación solo corría cuando alguien pulsaba "Ejecutar rotación": el
 * sistema calculaba la próxima fecha y nadie la cumplía. A las 6 a. m. para
 * que el aviso ("tu vehículo sale / vuelve") llegue antes de que la gente
 * saque el carro, y no a medianoche.
 *
 * Un complejo que falla no frena a los demás.
 */
@Injectable()
export class ParkingRotationCron {
  private readonly logger = new Logger(ParkingRotationCron.name);

  constructor(private readonly vehiclesService: VehiclesService) {}

  @Cron('0 6 * * *', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    const due = await this.vehiclesService.findDueRotationsInternal(new Date());
    if (due.length === 0) return;

    this.logger.log(`Rotaciones de parqueadero pendientes: ${due.length}`);

    for (const config of due) {
      try {
        await this.vehiclesService.runRotation(config, null);
      } catch (err) {
        this.logger.error(
          `No se pudo rotar el parqueadero del complejo ${config.complexId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}
