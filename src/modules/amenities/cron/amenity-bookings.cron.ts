import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AmenityBookingsService } from '../services/amenity-bookings.service';

/**
 * Mantenimiento de la agenda de zonas comunes.
 *
 * Sin esto la agenda se degrada sola: reservas pendientes que nadie aprobó
 * siguen ocupando cupo para siempre, y reservas aprobadas que ya terminaron
 * nunca cierran. Ambas cosas hacen que el motor de disponibilidad reporte
 * franjas ocupadas que en realidad están libres.
 */
@Injectable()
export class AmenityBookingsCron {
  private readonly logger = new Logger(AmenityBookingsCron.name);

  constructor(private readonly bookingsService: AmenityBookingsService) {}

  /**
   * Cada 15 minutos: cierra lo que ya venció. Es un barrido corto porque la
   * ventana relevante es la hora de inicio/fin de cada reserva, no el día.
   */
  @Cron('*/15 * * * *', { timeZone: 'America/Bogota' })
  async sweep(): Promise<void> {
    try {
      const [expired, completed, noShows] = [
        await this.bookingsService.expireStalePending(),
        await this.bookingsService.autoCompleteCheckedIn(),
        await this.bookingsService.markNoShows(),
      ];

      if (expired || completed || noShows) {
        this.logger.log(
          `Barrido de reservas — ${expired} expiradas, ${completed} completadas, ${noShows} sin ingreso`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Error en el barrido de reservas: ${err?.message}`,
        err?.stack,
      );
    }
  }

  /**
   * Recordatorio de las reservas del día siguiente. A las 8 a. m. porque un
   * push a medianoche no lo lee nadie.
   */
  @Cron('0 8 * * *', { timeZone: 'America/Bogota' })
  async reminders(): Promise<void> {
    try {
      const sent = await this.bookingsService.sendUpcomingReminders();
      if (sent > 0)
        this.logger.log(`Recordatorios de reserva enviados: ${sent}`);
    } catch (err: any) {
      this.logger.error(
        `Error al enviar recordatorios de reserva: ${err?.message}`,
        err?.stack,
      );
    }
  }
}
