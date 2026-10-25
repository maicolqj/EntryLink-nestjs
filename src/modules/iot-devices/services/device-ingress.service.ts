import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { Device } from '../entities/device.iot-entity';
import { PlanterReading } from '../entities/planter-reading.iot-entity';
import { DeviceType } from '../enums/device-type.enum';
import { DeviceStatus } from '../enums/device-status.enum';
import { parsePlanterTelemetry } from '../telemetry/planter-telemetry.parser';
import { IotSocketEmitter, IotSocketEvent } from '../socket/iot-socket.events';
import { DeviceAckWaiter } from '../themes/device-ack-waiter';
import {
  DEVICE_ALERTS_JOBS,
  DEVICE_ALERTS_QUEUE,
  EvaluateReadingJob,
  IOT_JOB_OPTIONS,
} from '../queues/iot-queues.constants';

export interface IngestResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
}

/**
 * Todo lo que llega DESDE los aparatos, venga por MQTT o por REST: misma
 * validación, misma persistencia, mismos eventos. Rápido a propósito: las
 * alertas (push) se encolan y no se esperan.
 */
@Injectable()
export class DeviceIngressService {
  private readonly logger = new Logger(DeviceIngressService.name);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(PlanterReading)
    private readonly readings: Repository<PlanterReading>,
    @InjectQueue(DEVICE_ALERTS_QUEUE)
    private readonly alertsQueue: Queue<EvaluateReadingJob>,
    private readonly sockets: IotSocketEmitter,
    private readonly acks: DeviceAckWaiter,
  ) {}

  findByDeviceId(deviceId: string): Promise<Device | null> {
    return this.devices.findOne({ where: { deviceId } });
  }

  async ingestTelemetry(
    device: Device,
    raw: unknown,
    via: 'mqtt' | 'rest',
  ): Promise<IngestResult> {
    const ahora = new Date();
    if (device.type !== DeviceType.SMART_PLANTER) {
      // Otros tipos aún no tienen tabla de lecturas: al menos se ve que está vivo
      await this.devices.update(device.id, {
        lastSeenAt: ahora,
        status: DeviceStatus.ONLINE,
      });
      return { ok: true };
    }
    const parsed = parsePlanterTelemetry(raw, ahora);
    if (!parsed.ok) {
      this.logger.warn(
        `[telemetry] ${device.deviceId} (${via}) descartada: ${parsed.error}`,
      );
      return { ok: false, error: parsed.error };
    }
    const t = parsed.value;

    // Misma lectura dos veces (MQTT + REST, o reintento) → índice único, se ignora
    const insert = await this.readings
      .createQueryBuilder()
      .insert()
      .into(PlanterReading)
      .values({
        deviceUuid: device.id,
        soil: t.soil,
        soilRaw: t.soilRaw,
        lux: t.lux,
        tempC: t.tempC,
        hum: t.hum,
        battery: t.battery,
        batteryPct: t.batteryPct,
        power: t.power,
        tankHasWater: t.tankHasWater,
        mood: t.mood,
        motion: t.motion,
        tilt: t.tilt,
        plantId: t.plantId,
        faults: t.faults,
        rssi: t.rssi,
        queued: t.queued,
        measuredAt: t.measuredAt,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const readingId: string | undefined =
      (insert.identifiers[0]?.id as string | undefined) ??
      (insert.raw as { id?: string }[] | undefined)?.[0]?.id;
    if (!readingId) return { ok: true, duplicate: true };

    const cambios: Partial<Device> = {
      lastSeenAt: ahora,
      status: DeviceStatus.ONLINE,
    };
    if (t.fw) cambios.firmwareVersion = t.fw;
    // Una lectura de la cola es vieja: no pisa el estado actual del aparato
    if (!t.queued) {
      cambios.lastTelemetry = raw as Record<string, unknown>;
      if (t.power) cambios.power = t.power;
      const tema = (raw as Record<string, unknown>).theme;
      if (typeof tema === 'string' && tema)
        cambios.faceTheme = tema.slice(0, 24);
    }
    await this.devices.update(device.id, cambios);

    if (device.ownerId) {
      this.sockets.toUser(device.ownerId, IotSocketEvent.TELEMETRY, {
        id: device.id,
        deviceId: device.deviceId,
        readingId,
        reading: { ...t, measuredAt: t.measuredAt.toISOString() },
      });
      // Solo lo que está pasando ahora genera alertas; la cola es histórico.
      // Sin dueño: se guarda la telemetría pero no se avisa a nadie.
      if (!t.queued) {
        await this.alertsQueue.add(
          DEVICE_ALERTS_JOBS.EVALUATE_READING,
          { deviceUuid: device.id, readingId },
          IOT_JOB_OPTIONS,
        );
      }
    }
    return { ok: true };
  }

  /** Broker: conectó/desconectó (o .../status "online"/"offline"). */
  async setConnected(deviceId: string, connected: boolean): Promise<void> {
    const device = await this.findByDeviceId(deviceId);
    if (!device || device.connected === connected) return;
    await this.devices.update(device.id, {
      connected,
      ...(connected ? { lastSeenAt: new Date() } : {}),
    });
    if (device.ownerId) {
      this.sockets.toUser(device.ownerId, IotSocketEvent.PRESENCE, {
        id: device.id,
        deviceId,
        connected,
      });
    }
  }

  /** .../ack: última respuesta a un comando, para la app. */
  async recordAck(device: Device, raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const ack: Record<string, unknown> = {
      ...(raw as Record<string, unknown>),
      at: new Date().toISOString(),
    };
    const cambios: Partial<Device> = { lastAck: ack };
    const tema =
      typeof ack.theme === 'string' && ack.theme
        ? ack.theme.slice(0, 24)
        : null;
    if (ack.cmd === 'themes') {
      // Informe de capacidades (una vez por encendido o ante ping_themes)
      const lista = Array.isArray(ack.themes) ? (ack.themes as unknown[]) : [];
      cambios.capabilities = {
        hasSD: ack.hasSD === true,
        hasPSRAM: ack.hasPSRAM === true,
        themes: lista
          .filter(
            (x): x is Record<string, unknown> =>
              !!x &&
              typeof x === 'object' &&
              typeof (x as Record<string, unknown>).id === 'string',
          )
          .slice(0, 20)
          .map((x) => ({
            id: (x.id as string).slice(0, 24),
            kind: typeof x.kind === 'string' ? x.kind : undefined,
            available: x.available === true,
            ...(typeof x.reason === 'string' ? { reason: x.reason } : {}),
          })),
        reportedAt: ack.at as string,
      };
    }
    if (tema && (ack.cmd === 'themes' || ack.cmd === 'set_theme'))
      cambios.faceTheme = tema;
    await this.devices.update(device.id, cambios);

    if (device.ownerId) {
      this.sockets.toUser(device.ownerId, IotSocketEvent.ACK, {
        id: device.id,
        deviceId: device.deviceId,
        ack,
      });
      if (ack.cmd === 'set_theme') {
        this.sockets.toUser(device.ownerId, IotSocketEvent.THEME, {
          id: device.id,
          deviceId: device.deviceId,
          ok: ack.ok === true,
          themeId: ack.themeId,
          theme: tema,
          reason: ack.reason ?? null,
          fallback: ack.fallback === true,
        });
      }
    }
    this.acks.notify(device.deviceId, ack);
    if (ack.cmd === 'ota' || ack.ok === false) {
      this.logger.log(`[ack] ${device.deviceId}: ${JSON.stringify(ack)}`);
    }
  }
}
