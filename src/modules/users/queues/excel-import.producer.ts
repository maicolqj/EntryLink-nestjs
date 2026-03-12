import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import {
  EXCEL_IMPORT_QUEUE,
  EXCEL_IMPORT_JOBS,
  ExcelImportJobPayload,
} from './excel-import.constants';

@Injectable()
export class ExcelImportProducer {
  private readonly logger = new Logger(ExcelImportProducer.name);

  constructor(
    @InjectQueue(EXCEL_IMPORT_QUEUE) private readonly importQueue: Queue,
  ) {}

  async enqueueResidentImport(
    filePath: string,
    complexId: string,
    adminUserId: string,
  ): Promise<string> {
    const importId = uuidv4();

    const payload: ExcelImportJobPayload = {
      filePath,
      complexId,
      adminUserId,
      importId,
    };

    await this.importQueue.add(EXCEL_IMPORT_JOBS.PROCESS_RESIDENTS, payload, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5_000 },
      removeOnComplete: { count: 50, age: 24 * 3600 }, // limpiar después de 24h
      removeOnFail: { count: 20, age: 7 * 24 * 3600 }, // mantener errores 7 días
    });

    this.logger.log(
      `Excel import enqueued — importId: ${importId} | complexId: ${complexId} | admin: ${adminUserId}`,
    );

    return importId;
  }
}
