import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { unlink } from 'fs/promises';

import { Auth }       from '../shared/decorators/auth.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';
import { ValidPermissions } from '../permissions/enums/valid-permissions';
import { OpeningBalancesImportService } from './import/opening-balances-import.service';
import { OpeningBalancesImportResult }  from './import/opening-balances-import.constants';

const MAX_ROWS = 5000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

@Controller('finance')
export class FinanceController {
  private readonly logger = new Logger(FinanceController.name);

  constructor(
    private readonly openingBalancesImport: OpeningBalancesImportService,
  ) {}

  /**
   * Importa SALDOS DE APERTURA de una copropiedad desde un Excel/CSV exportado de
   * su software contable anterior (migración).
   *
   * Form-data:
   *   - file       : archivo .xlsx/.xls/.csv (plantilla canónica)
   *   - complexId  : UUID del complejo destino
   *   - period     : período de corte YYYY-MM (ej. "2025-12")
   *   - dryRun     : "true" (preview, default) | "false" (confirma y escribe)
   *
   * Flujo recomendado en el front: primero llamar con dryRun=true para mostrar
   * totales y errores; si el usuario confirma, llamar de nuevo con dryRun=false.
   * La operación es idempotente: re-ejecutar no duplica saldos.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('import-opening-balances')
  @HttpCode(HttpStatus.OK)
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.GENERATE_CHARGES],
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'tmp', 'finance-imports'),
        filename: (_req, file, cb) => {
          const unique = randomBytes(8).toString('hex');
          const ext    = extname(file.originalname).toLowerCase();
          cb(null, `opening-balances-${unique}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          return cb(
            new BadRequestException(`Formato no permitido. Use: ${ALLOWED_EXTENSIONS.join(', ')}`),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async importOpeningBalances(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ): Promise<OpeningBalancesImportResult> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo');
    }

    try {
      const complexId: string = req.body?.complexId;
      const period: string    = req.body?.period;
      // Por seguridad el default es preview: solo escribe con dryRun explícito en "false".
      const dryRun = String(req.body?.dryRun ?? 'true').toLowerCase() !== 'false';

      if (!complexId) throw new BadRequestException('El campo complexId es requerido');
      if (!period)    throw new BadRequestException('El campo period (YYYY-MM) es requerido');

      let rowCount: number;
      try {
        rowCount = await this.openingBalancesImport.countRows(file.path);
      } catch (err: any) {
        throw new BadRequestException(`No se pudo leer el archivo: ${err?.message ?? 'formato inválido'}`);
      }

      if (rowCount === 0) {
        throw new BadRequestException('El archivo no contiene filas de datos');
      }
      if (rowCount > MAX_ROWS) {
        throw new BadRequestException(
          `El archivo contiene ${rowCount} filas. El máximo permitido es ${MAX_ROWS}.`,
        );
      }

      const result = await this.openingBalancesImport.import(
        file.path,
        complexId,
        period,
        dryRun,
        req.user,
      );

      this.logger.log(
        `Import saldos apertura — complex: ${complexId} | período: ${period} | ` +
        `dryRun: ${dryRun} | válidas: ${result.validRows} | errores: ${result.errorRows}`,
      );

      return result;
    } finally {
      await unlink(file.path).catch(() => {});
    }
  }
}
