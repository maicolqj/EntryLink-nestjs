import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { DeviceHealthService } from '../services/device-health.service';

/**
 * Verificación silenciosa semanal de la entrega push.
 *
 * Un equipo puede dejar de recibir alertas sin que nadie se entere: basta una
 * actualización del sistema que reactive la optimización de batería, o que el
 * usuario limpie los permisos. Sin esta ronda, el fallo se descubre durante una
 * emergencia real.
 *
 * Lunes 3am hora de Bogotá: fuera de turno y antes de que arranque la semana, así
 * un equipo caído se detecta con días de margen.
 */
@Injectable()
export class DeviceHealthCron {
  private readonly logger = new Logger(DeviceHealthCron.name);

  constructor(private readonly deviceHealthService: DeviceHealthService) {}

  @Cron('0 3 * * 1', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    // Primero se cierran las pruebas de la ronda anterior que nunca contestaron;
    // si se hiciera después, se contarían como fallidas las recién enviadas.
    await this.deviceHealthService.expireStaleChecks();

    // Solo vigilancia y supervisión: push_subscriptions es compartida con
    // RemoteLink y barrer todos los Android le mandaría a cada residente un push
    // que su app no sabe interpretar.
    const subscriptionIds = await this.deviceHealthService.findDevicesToMonitor();

    this.logger.log(`Health-check semanal — ${subscriptionIds.length} equipos de vigilancia`);

    let failed = 0;
    for (const id of subscriptionIds) {
      try {
        await this.deviceHealthService.sendHealthCheck(id);
      } catch (err) {
        // Un token muerto no puede cortar la ronda de los demás.
        failed += 1;
        this.logger.warn(`Health-check falló para ${id}: ${(err as Error)?.message}`);
      }
    }

    this.logger.log(`Health-check semanal enviado (${subscriptionIds.length - failed} ok, ${failed} con error)`);
  }

  /**
   * Cierra las pruebas sin respuesta una hora después de la ronda. Se separa del
   * envío porque un ACK no se puede esperar de forma síncrona: la entrega ocurre
   * fuera del proceso y hay que volver a mirar quién no contestó.
   */
  @Cron('0 4 * * 1', { timeZone: 'America/Bogota' })
  async closeRound(): Promise<void> {
    const marked = await this.deviceHealthService.expireStaleChecks();
    this.logger.log(`Ronda semanal cerrada — ${marked} dispositivos sin responder`);
  }
}
