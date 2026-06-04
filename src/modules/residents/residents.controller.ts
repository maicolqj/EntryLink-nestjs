import {
  BadRequestException,
  Controller,
  ForbiddenException,
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
import { ResidentsImportService }  from './services/residents-import.service';
import { ResidentsImportProducer } from './queues/residents-import.producer';

const MAX_ROWS = 1000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

@Controller('residents')
export class ResidentsController {
  private readonly logger = new Logger(ResidentsController.name);

  constructor(
    private readonly importService:  ResidentsImportService,
    private readonly importProducer: ResidentsImportProducer,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('import')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'tmp', 'resident-imports'),
        filename: (_req, file, cb) => {
          const unique = randomBytes(8).toString('hex');
          const ext    = extname(file.originalname).toLowerCase();
          cb(null, `resident-import-${unique}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          return cb(
            new BadRequestException(
              `Formato no permitido. Use: ${ALLOWED_EXTENSIONS.join(', ')}`,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async importResidents(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ): Promise<{ jobId: string; message: string }> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo');
    }

    const complexId: string = req.body?.complexId;
    if (!complexId) {
      throw new BadRequestException('El campo complexId es requerido');
    }

    const callerRoles: string[]       = req.user?.roles ?? [];
    const callerComplexId: string     = req.user?.complexId;
    const isSuperAdmin = callerRoles.includes(ValidRoles.SUPER_ADMIN_ROL);

    if (!isSuperAdmin && callerComplexId !== complexId) {
      await unlink(file.path).catch(() => {});
      throw new ForbiddenException(
        'No tienes permisos para importar residentes en este complejo',
      );
    }

    const adminUserId: string = req.user?.sub;
    // When entityType === 'complex', sub is the complex UUID — not a user UUID.
    // Setting approvedByUserId to it would violate the FK to users table.
    const approvedByUserId: string | null =
      req.user?.entityType === 'user' ? adminUserId : null;

    // Validate row count before enqueuing
    let rowCount: number;
    try {
      rowCount = await this.importService.countRows(file.path);
    } catch (err: any) {
      await unlink(file.path).catch(() => {});
      throw new BadRequestException(
        `No se pudo leer el archivo: ${err?.message ?? 'formato inválido'}`,
      );
    }

    if (rowCount === 0) {
      await unlink(file.path).catch(() => {});
      throw new BadRequestException('El archivo no contiene filas de datos');
    }

    if (rowCount > MAX_ROWS) {
      await unlink(file.path).catch(() => {});
      throw new BadRequestException(
        `El archivo contiene ${rowCount} filas. El máximo permitido es ${MAX_ROWS}.`,
      );
    }

    const jobId = await this.importProducer.enqueue(file.path, complexId, adminUserId, approvedByUserId);

    this.logger.log(
      `Importación iniciada — jobId: ${jobId} | filas: ${rowCount} | complex: ${complexId}`,
    );

    return { jobId, message: 'Importación iniciada' };
  }
}
