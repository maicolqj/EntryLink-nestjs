import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { unlink } from 'fs/promises';

import {
  EXCEL_IMPORT_QUEUE,
  EXCEL_IMPORT_JOBS,
  ExcelImportJobPayload,
  ResidentRowData,
  ImportResult,
} from './excel-import.constants';
import { ExcelImportService } from '../services/excel-import.service';

@Processor(EXCEL_IMPORT_QUEUE)
export class ExcelImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExcelImportProcessor.name);

  constructor(private readonly excelImportService: ExcelImportService) {
    super();
  }

  async process(job: Job): Promise<ImportResult | void> {
    switch (job.name) {
      case EXCEL_IMPORT_JOBS.PROCESS_RESIDENTS:
        return this.handleResidentImport(job as Job<ExcelImportJobPayload>);
      default:
        this.logger.warn(`Job desconocido en cola excel-import: ${job.name}`);
    }
  }

  private async handleResidentImport(job: Job<ExcelImportJobPayload>): Promise<ImportResult> {
    const { filePath, complexId, adminUserId, importId } = job.data;

    this.logger.log(`Procesando importación Excel — importId: ${importId}`);

    let rows: ResidentRowData[] = [];

    try {
      // 1. Parsear Excel
      rows = await this.excelImportService.parseExcel(filePath);
      this.logger.log(`${rows.length} filas encontradas en el archivo`);

      // 2. Actualizar progreso
      await job.updateProgress(20);

      // 3. Procesar e insertar en batches de 50
      const result = await this.excelImportService.processRows(
        rows,
        complexId,
        adminUserId,
        async (progress: number) => job.updateProgress(20 + Math.floor(progress * 0.8)),
      );

      await job.updateProgress(100);

      this.logger.log(
        `Importación completada — importId: ${importId} | ` +
        `ok: ${result.successCount} | errores: ${result.errorCount}`,
      );

      return { ...result, importId };

    } finally {
      // Limpiar archivo temporal siempre, incluso si hay error
      try {
        await unlink(filePath);
      } catch {
        this.logger.warn(`No se pudo eliminar archivo temporal: ${filePath}`);
      }
    }
  }
}
