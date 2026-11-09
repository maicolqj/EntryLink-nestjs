import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { DeviceNotificationsService } from '../notifications/device-notifications.service';
import {
  DEVICE_NOTIFY_JOBS,
  DEVICE_NOTIFY_QUEUE,
  EntrylinkNotificationJob,
} from './iot-queues.constants';

/** Worker `device-notify`: notificación de EntryLink → aro LED + buzzer + icono en los aparatos. */
@Processor(DEVICE_NOTIFY_QUEUE)
export class DeviceNotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(DeviceNotifyProcessor.name);

  constructor(private readonly notifications: DeviceNotificationsService) {
    super();
  }

  async process(job: Job<EntrylinkNotificationJob>): Promise<number> {
    if (job.name !== DEVICE_NOTIFY_JOBS.FROM_ENTRYLINK) return 0;
    const n = await this.notifications.deliverFromEntrylink(job.data);
    if (n) this.logger.log(`[notify] ${job.data.type} → ${n} aparato(s)`);
    return n;
  }
}
