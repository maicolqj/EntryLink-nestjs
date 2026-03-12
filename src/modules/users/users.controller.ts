import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Request,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { UsersService } from './users.service';

/**
 * Endpoint REST para importación masiva de residentes por Excel.
 *
 * POST /api/v1/users/bulk-import
 * Content-Type: multipart/form-data
 * Authorization: Bearer <token> (requiere COMPLEX_ROL)
 *
 * Body:
 *   file: archivo .xlsx o .xls
 *   complexId: UUID del complejo
 *
 * Respuesta:
 *   { importId: string } — ID para consultar el estado del proceso
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('bulk-import')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'tmp', 'excel-imports'),
        filename: (_req, file, cb) => {
          const unique = randomBytes(8).toString('hex');
          const ext = extname(file.originalname);
          cb(null, `import-${unique}${ext}`);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB máx
        files: 1,
      },
      fileFilter: (_req, file, cb) => {
        const allowed = ['.xlsx', '.xls'];
        const ext = extname(file.originalname).toLowerCase();
        if (!allowed.includes(ext)) {
          return cb(
            new BadRequestException('Solo se permiten archivos Excel (.xlsx, .xls)'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ): Promise<{ importId: string; message: string }> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo');
    }

    const complexId: string = req.body?.complexId;
    if (!complexId) {
      throw new BadRequestException('El campo complexId es requerido');
    }

    // Verificar que el usuario autenticado tenga acceso al complejo
    // (En producción validar que payload.complexId === complexId o sea SUPER_ADMIN)
    const adminUserId: string = req.user?.sub;

    const importId = await this.usersService.bulkImportResidents(
      file.path,
      complexId,
      adminUserId,
    );

    return {
      importId,
      message: `Importación iniciada. Usa el importId para consultar el progreso.`,
    };
  }
}
