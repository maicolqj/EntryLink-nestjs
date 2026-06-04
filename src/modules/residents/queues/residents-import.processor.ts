import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { unlink } from 'fs/promises';

import {
  RESIDENTS_IMPORT_QUEUE,
  RESIDENTS_IMPORT_JOBS,
  ResidentImportJobPayload,
  ResidentImportError,
} from './residents-import.constants';
import { ResidentsImportService } from '../services/residents-import.service';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';

@Processor(RESIDENTS_IMPORT_QUEUE)
export class ResidentsImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ResidentsImportProcessor.name);

  constructor(
    private readonly importService: ResidentsImportService,
    private readonly socketService: SocketService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === RESIDENTS_IMPORT_JOBS.PROCESS_FILE) {
      await this.handleImport(job as Job<ResidentImportJobPayload>);
    } else {
      this.logger.warn(`Job desconocido en cola residents-import: ${job.name}`);
    }
  }

  private async handleImport(job: Job<ResidentImportJobPayload>): Promise<void> {
    const { filePath, complexId, adminUserId, approvedByUserId, jobId } = job.data;

    this.logger.log(`Iniciando importación de residentes — jobId: ${jobId}`);

    try {
      const rows = await this.importService.parseFile(filePath);
      const total = rows.length;

      this.logger.log(`${total} filas a procesar — jobId: ${jobId}`);

      let lastEmittedBucket = -1;

      const result = await this.importService.processRows(
        rows,
        complexId,
        approvedByUserId,
        (done, _total, successCount, errorCount) => {
          const percent = total > 0 ? Math.floor((done / total) * 100) : 100;
          const bucket  = Math.floor(percent / 10);
          const shouldEmit = done % 5 === 0 || bucket > lastEmittedBucket;

          if (shouldEmit) {
            lastEmittedBucket = bucket;
            this.socketService.emitToComplex(complexId, SocketEvent.RESIDENT_IMPORT_PROGRESS, {
              jobId,
              complexId,
              done,
              total,
              percent,
              successCount,
              errorCount,
            });
          }
        },
      );

      this.emitDone(complexId, jobId, result.total, result.successCount, result.errorCount, result.errors);

      this.logger.log(
        `Importación completada — jobId: ${jobId} | ok: ${result.successCount} | errores: ${result.errorCount}`,
      );

    } finally {
      try {
        await unlink(filePath);
      } catch {
        this.logger.warn(`No se pudo eliminar archivo temporal: ${filePath}`);
      }
    }
  }

  private emitDone(
    complexId: string,
    jobId: string,
    total: number,
    successCount: number,
    errorCount: number,
    errors: ResidentImportError[],
  ): void {
    this.socketService.emitToComplex(complexId, SocketEvent.RESIDENT_IMPORT_DONE, {
      jobId,
      complexId,
      total,
      successCount,
      errorCount,
      errors,
    });
  }
}
