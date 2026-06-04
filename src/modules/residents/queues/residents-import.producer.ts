import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

import {
  RESIDENTS_IMPORT_QUEUE,
  RESIDENTS_IMPORT_JOBS,
  ResidentImportJobPayload,
} from './residents-import.constants';

@Injectable()
export class ResidentsImportProducer {
  private readonly logger = new Logger(ResidentsImportProducer.name);

  constructor(
    @InjectQueue(RESIDENTS_IMPORT_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(
    filePath: string,
    complexId: string,
    adminUserId: string,
    approvedByUserId: string | null,
  ): Promise<string> {
    const jobId = uuidv4();

    const payload: ResidentImportJobPayload = { filePath, complexId, adminUserId, approvedByUserId, jobId };

    await this.queue.add(RESIDENTS_IMPORT_JOBS.PROCESS_FILE, payload, {
      attempts: 1,
      removeOnComplete: { count: 50, age: 24 * 3600 },
      removeOnFail:    { count: 20, age: 7 * 24 * 3600 },
    });

    this.logger.log(
      `Residents import enqueued — jobId: ${jobId} | complexId: ${complexId}`,
    );

    return jobId;
  }
}
