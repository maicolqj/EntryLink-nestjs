import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';

import { Device } from '../entities/device.iot-entity';
import { DeviceStatus } from '../enums/device-status.enum';
import { IOT_CONFIG, IotConfig } from '../iot.config';
import { DeviceAlertDispatcher } from '../alerts/device-alert.dispatcher';
import { DeviceOutboxService } from '../services/device-outbox.service';

/**
 * Cada hora: aparatos con dueño que no reportan hace más de
 * IOT_OFFLINE_AFTER_MIN (2 h) → OFFLINE + alerta `offline` (máx. 1 cada 24 h).
 * Con batería la matera reporta cada 30 min, así que 2 h son 4 despertares
 * perdidos. De paso limpia la outbox.
 *
 * Es un @Cron de este módulo (como PetsCron): solo existe con IOT_ENABLED.
 */
@Injectable()
export class DevicesOfflineCron {
  private readonly logger = new Logger(DevicesOfflineCron.name);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @Inject(IOT_CONFIG) private readonly config: IotConfig,
    private readonly dispatcher: DeviceAlertDispatcher,
    private readonly outbox: DeviceOutboxService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'iot-devices-offline' })
  async run(now: Date = new Date()): Promise<number> {
    const limite = new Date(
      now.getTime() - this.config.offlineAfterMin * 60_000,
    );
    const callados = await this.devices.find({
      where: {
        ownerId: Not(IsNull()),
        status: DeviceStatus.ONLINE,
        lastSeenAt: LessThan(limite),
      },
      take: 500,
    });
    for (const device of callados) {
      await this.devices.update(device.id, {
        status: DeviceStatus.OFFLINE,
        connected: false,
      });
      await this.dispatcher.dispatch(device, 'offline', undefined, now);
    }
    if (callados.length)
      this.logger.log(`[offline] ${callados.length} aparatos pasan a OFFLINE`);
    await this.outbox.purgeOld();
    return callados.length;
  }
}
