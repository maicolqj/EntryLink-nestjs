import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportCommitService } from './import-commit.service';
import {
  GROWTH_IMPORTS_QUEUE,
  GrowthImportJob,
  IMPORT_JOB_ATTEMPTS,
  IMPORT_JOBS,
} from './import-queue.service';
import { ImportValidationService } from './import-validation.service';
import { ImportsService } from './imports.service';

/** Worker de la cola growth-imports: validación y confirmación de lotes. */
@Processor(GROWTH_IMPORTS_QUEUE)
export class ImportJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportJobsProcessor.name);

  constructor(
    private readonly validation: ImportValidationService,
    private readonly commitService: ImportCommitService,
    private readonly imports: ImportsService,
  ) {
    super();
  }

  /** Agotados los reintentos, el lote queda FAILED (sin datos en el motivo). */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<GrowthImportJob> | undefined,
    error: Error,
  ): Promise<void> {
    this.logger.error(
      `Trabajo ${job?.name ?? '?'} (${job?.id ?? '?'}) falló: ${error.message}`,
    );
    if (job && job.attemptsMade >= (job.opts.attempts ?? IMPORT_JOB_ATTEMPTS)) {
      await this.imports.markFailed(
        job.data.batchId,
        job.name === IMPORT_JOBS.VALIDATE
          ? 'La validación falló tras varios intentos'
          : 'La confirmación falló tras varios intentos; las filas ya procesadas se conservan',
      );
    }
  }

  async process(job: Job<GrowthImportJob>): Promise<void> {
    switch (job.name) {
      case IMPORT_JOBS.VALIDATE:
        await this.validation.validate(
          job.data.batchId,
          job.data.mappingKey ?? '',
          job.data.actor,
        );
        return;
      case IMPORT_JOBS.COMMIT:
        await this.commitService.commit(job.data.batchId, job.data.actor);
        return;
      default:
        this.logger.warn(`Trabajo desconocido: ${job.name}`);
    }
  }
}
