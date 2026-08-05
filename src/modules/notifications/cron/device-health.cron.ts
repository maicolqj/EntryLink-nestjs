import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PushSubscription }    from '../entities/push-subscription.entity';
import { PushPlatform }        from '../enums/push-platform.enum';
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

  constructor(
    @InjectRepository(PushSubscription)
    private readonly pushSubRepo: Repository<PushSubscription>,
    private readonly deviceHealthService: DeviceHealthService,
  ) {}

  @Cron('0 3 * * 1', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    // Primero se cierran las pruebas de la ronda anterior que nunca contestaron;
    // si se hiciera después, se contarían como fallidas las recién enviadas.
    await this.deviceHealthService.expireStaleChecks();

    const devices = await this.pushSubRepo.find({
      where:  { isActive: true, platform: PushPlatform.ANDROID },
      select: ['id'],
    });

    this.logger.log(`Health-check semanal — ${devices.length} dispositivos`);

    let failed = 0;
    for (const device of devices) {
      try {
        await this.deviceHealthService.sendHealthCheck(device.id);
      } catch (err) {
        // Un token muerto no puede cortar la ronda de los demás.
        failed += 1;
        this.logger.warn(`Health-check falló para ${device.id}: ${(err as Error)?.message}`);
      }
    }

    this.logger.log(`Health-check semanal enviado (${devices.length - failed} ok, ${failed} con error)`);
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
