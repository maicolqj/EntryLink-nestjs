import {
  Controller,
  Post,
  Param,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Request,
  BadRequestException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { Request as ExpressRequest } from 'express';
import { Auth } from '../shared/decorators/auth.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';
import { UsersService } from './users.service';
import { R2StorageService }        from '../../core/infrastructure/r2/r2.service';
import { singleImageInterceptor }  from '../../core/infrastructure/r2/upload-interceptors';
import { JwtRestGuard }            from '../shared/guards/jwt-rest.guard';
import { JwtAccessPayload }        from '../shared/interfaces/jwt-payload.interface';

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
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService:  UsersService,
    private readonly storageService: R2StorageService,
  ) {}

  // VULN-16 fix: throttle específico para bulk-import — máx 5 uploads por minuto por IP
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('bulk-import')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
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

    const callerRoles: string[] = req.user?.roles ?? [];
    const callerComplexId: string | undefined = req.user?.complexId;
    const isSuperAdmin = callerRoles.includes(ValidRoles.SUPER_ADMIN_ROL);

    if (!isSuperAdmin && callerComplexId !== complexId) {
      throw new ForbiddenException('No tienes permisos para importar residentes en este complejo');
    }

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

  /**
   * POST /api/v1/users/:userId/profile-picture
   *
   * Sube o reemplaza la foto de perfil de un usuario en Cloudflare R2.
   * Body (multipart/form-data): photo — jpeg/png/webp/heic, máx 5 MB
   *
   * Permitido: el propio usuario, COMPLEX_ROL y SUPER_ADMIN_ROL.
   */
  @Post(':userId/profile-picture')
  @UseGuards(JwtRestGuard)
  @UseInterceptors(singleImageInterceptor('photo', { maxSizeMb: 5 }))
  async uploadProfilePicture(
    @Param('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: ExpressRequest,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    const isSelf       = currentUser.sub === userId;
    const isPrivileged = currentUser.roles?.some(r =>
      [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL].includes(r),
    );

    if (!isSelf && !isPrivileged) {
      throw new ForbiddenException('No tienes permisos para modificar la foto de este usuario');
    }

    if (!file) {
      throw new BadRequestException('El campo photo es requerido');
    }

    const folder = this.storageService.buildFolder('users', 'profile-pictures');

    let publicId: string | undefined;
    try {
      const result = await this.storageService.uploadBuffer(
        file.buffer,
        folder,
        file.originalname,
      );
      publicId = result.publicId;

      const user = await this.usersService.updateProfilePicture(userId, result.url);
      this.logger.log(`Foto de perfil actualizada para usuario ${userId}`);
      return { success: true, profilePicture: user.profilePicture };

    } catch (err: any) {
      if (publicId) {
        this.logger.warn(`Rollback R2: eliminando imagen huérfana ${publicId}`);
        await this.storageService.deleteByPublicId(publicId).catch(() => undefined);
      }
      throw err;
    }
  }
}
