import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';

import { Device } from '../entities/device.iot-entity';
import {
  DeviceOutboxMessage,
  OutboxChannel,
} from '../entities/device-outbox.iot-entity';
import { DevicePublisher } from '../mqtt/device-publisher';

/** Cuánto espera un comando si el aparato no está conectado. */
export const CMD_TTL_S = {
  linked: 7 * 24 * 3600,
  factory_reset: 30 * 24 * 3600,
  set_plant: 30 * 24 * 3600,
  ota: 24 * 3600,
  identify: 5 * 60,
  ping: 5 * 60,
  set_theme: 7 * 24 * 3600,
  ping_themes: 30 * 60,
} as const;

export type DeviceCommand = keyof typeof CMD_TTL_S;

/**
 * Salida hacia los aparatos (cmd y notify). Si el aparato está conectado al
 * broker, se publica ya (QoS 1); si no, espera en `iot_device_outbox` hasta
 * que se conecte y se suscriba (la matera con batería lo hace en cada
 * despertar). Lo caducado se descarta sin entregar.
 */
@Injectable()
export class DeviceOutboxService {
  private readonly logger = new Logger(DeviceOutboxService.name);

  constructor(
    @InjectRepository(DeviceOutboxMessage)
    private readonly outbox: Repository<DeviceOutboxMessage>,
    private readonly publisher: DevicePublisher,
  ) {}

  async sendCommand(
    device: Pick<Device, 'id' | 'deviceId'>,
    cmd: DeviceCommand,
    extra: Record<string, unknown> = {},
  ) {
    return this.send(device, 'cmd', { cmd, ...extra }, CMD_TTL_S[cmd]);
  }

  /** true = salió ya por MQTT · false = quedó en la cola. */
  async send(
    device: Pick<Device, 'id' | 'deviceId'>,
    channel: OutboxChannel,
    payload: Record<string, unknown>,
    ttlS: number,
  ): Promise<boolean> {
    if (
      this.publisher.isConnected(device.deviceId) &&
      (await this.publisher.publish(device.deviceId, channel, payload))
    ) {
      return true;
    }
    await this.outbox.save(
      this.outbox.create({
        deviceUuid: device.id,
        channel,
        payload,
        expiresAt: new Date(Date.now() + ttlS * 1000),
      }),
    );
    this.logger.debug(
      `[outbox] ${device.deviceId} ${channel} en cola (${ttlS} s)`,
    );
    return false;
  }

  /** Al suscribirse el aparato a cmd/notify: entrega lo pendiente de ese canal, en orden. */
  async flush(
    device: Pick<Device, 'id' | 'deviceId'>,
    channel: OutboxChannel,
  ): Promise<number> {
    const pendientes = await this.outbox.find({
      where: {
        deviceUuid: device.id,
        channel,
        deliveredAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'ASC' },
      take: 20,
    });
    let entregados = 0;
    for (const m of pendientes) {
      if (!(await this.publisher.publish(device.deviceId, channel, m.payload)))
        break;
      await this.outbox.update(m.id, { deliveredAt: new Date() });
      entregados++;
    }
    if (entregados)
      this.logger.log(
        `[outbox] ${device.deviceId}: ${entregados} ${channel} entregados al conectar`,
      );
    return entregados;
  }

  /** Reset de fábrica: lo pendiente era del dueño anterior. */
  async discardPending(
    deviceUuid: string,
    channel?: OutboxChannel,
  ): Promise<void> {
    await this.outbox.delete({
      deviceUuid,
      deliveredAt: IsNull(),
      ...(channel ? { channel } : {}),
    });
  }

  /** Limpieza: lo entregado o caducado hace más de 7 días. */
  async purgeOld(): Promise<void> {
    const limite = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await this.outbox.delete({ expiresAt: LessThan(limite) });
  }
}
