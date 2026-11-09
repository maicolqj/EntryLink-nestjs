import { Injectable, Logger } from '@nestjs/common';
import type Aedes from 'aedes';

import { DeviceOutboundTopic, topicFor } from './iot-topics';

/**
 * Publicar hacia un aparato y saber si está conectado. Lo usa la outbox; el
 * broker le pasa su instancia al arrancar. Va aparte del broker para que la
 * outbox no dependa de él (el broker sí depende de la outbox para entregar lo
 * pendiente al conectar).
 */
@Injectable()
export class DevicePublisher {
  private readonly logger = new Logger(DevicePublisher.name);
  private broker: Aedes | null = null;
  private readonly conectados = new Set<string>();

  attach(broker: Aedes | null): void {
    this.broker = broker;
    if (!broker) this.conectados.clear();
  }

  markConnected(deviceId: string, connected: boolean): void {
    if (connected) this.conectados.add(deviceId);
    else this.conectados.delete(deviceId);
  }

  isConnected(deviceId: string): boolean {
    return !!this.broker && this.conectados.has(deviceId);
  }

  publish(
    deviceId: string,
    channel: DeviceOutboundTopic,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const broker = this.broker;
    if (!broker) return Promise.resolve(false);
    const datos = JSON.stringify(payload);
    // El firmware descarta los mensajes de más de 512 bytes
    if (Buffer.byteLength(datos) > 512) {
      this.logger.warn(
        `[mqtt] ${deviceId} ${channel}: ${Buffer.byteLength(datos)} B > 512, no se envía`,
      );
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      broker.publish(
        {
          cmd: 'publish',
          topic: topicFor(deviceId, channel),
          payload: Buffer.from(datos),
          qos: 1,
          retain: false,
          dup: false,
        },
        (error?: Error) => {
          if (error)
            this.logger.warn(
              `[mqtt] no se pudo publicar en ${deviceId}/${channel}: ${error.message}`,
            );
          resolve(!error);
        },
      );
    });
  }
}
