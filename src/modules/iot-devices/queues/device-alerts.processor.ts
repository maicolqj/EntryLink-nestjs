import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { LessThan, Repository } from 'typeorm';

import { Device } from '../entities/device.iot-entity';
import { PlanterReading } from '../entities/planter-reading.iot-entity';
import { DeviceAlertDispatcher } from '../alerts/device-alert.dispatcher';
import {
  decidePlanterAlerts,
  SUSTAINED_READINGS,
  thresholdsFrom,
} from '../alerts/planter-alert.rules';
import {
  DEVICE_ALERTS_JOBS,
  DEVICE_ALERTS_QUEUE,
  EvaluateReadingJob,
} from './iot-queues.constants';

/**
 * Worker `device-alerts`: decide y envía las alertas de una lectura nueva.
 * Corre fuera de la petición de telemetría, que así responde en < 200 ms.
 */
@Processor(DEVICE_ALERTS_QUEUE)
export class DeviceAlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(DeviceAlertsProcessor.name);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(PlanterReading)
    private readonly readings: Repository<PlanterReading>,
    private readonly dispatcher: DeviceAlertDispatcher,
  ) {
    super();
  }

  async process(job: Job<EvaluateReadingJob>): Promise<string[]> {
    if (job.name !== DEVICE_ALERTS_JOBS.EVALUATE_READING) return [];
    const { deviceUuid, readingId } = job.data;
    const [device, actual] = await Promise.all([
      this.devices.findOne({ where: { id: deviceUuid } }),
      this.readings.findOne({ where: { id: readingId } }),
    ]);
    // Sin dueño (o lo perdió por un reset mientras esperaba): no se avisa a nadie
    if (!device?.ownerId || !actual) return [];

    const anteriores = await this.readings.find({
      where: {
        deviceUuid,
        measuredAt: LessThan(actual.measuredAt),
        queued: false,
      },
      order: { measuredAt: 'DESC' },
      take: SUSTAINED_READINGS - 1,
    });
    const kinds = decidePlanterAlerts(
      actual,
      anteriores,
      thresholdsFrom(device.config?.plant),
    );
    const enviadas: string[] = [];
    for (const kind of kinds) {
      const r = await this.dispatcher.dispatch(device, kind, {
        ...actual,
        previousSoil: anteriores[0]?.soil,
      });
      if (r === 'sent') enviadas.push(kind);
    }
    if (enviadas.length)
      this.logger.log(`[alert] ${device.deviceId}: ${enviadas.join(', ')}`);
    return enviadas;
  }
}
