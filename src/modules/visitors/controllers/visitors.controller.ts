import {
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Logger,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { VisitorsService }           from '../services/visitors.service';
import { R2StorageService }           from '../../../core/infrastructure/r2/r2.service';
import { singleImageInterceptor }     from '../../../core/infrastructure/r2/upload-interceptors';
import { JwtRestGuard }               from '../../shared/guards/jwt-rest.guard';
import { JwtAccessPayload }           from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }                 from '../../roles/enums/valid-roles';
import { CustomError }                from '../../shared/utils/errors.utils';
import { GeneralErrorCode }           from '../../shared/constans/error-codes.constants';

const ALLOWED_ROLES: ValidRoles[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
];

@Controller('visitors')
@UseGuards(JwtRestGuard)
export class VisitorsController {
  private readonly logger = new Logger(VisitorsController.name);

  constructor(
    private readonly visitorsService: VisitorsService,
    private readonly storageService:  R2StorageService,
  ) {}

  /**
   * POST /api/v1/visitors/:visitorId/photo
   *
   * Sube o reemplaza la foto de un visitante en Cloudflare R2.
   * Body (multipart/form-data): photo — jpeg/png/webp/heic, máx 5 MB
   */
  @Post(':visitorId/photo')
  @UseInterceptors(singleImageInterceptor('photo', { maxSizeMb: 5 }))
  async uploadPhoto(
    @Param('visitorId') visitorId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!currentUser.roles?.some(r => ALLOWED_ROLES.includes(r))) {
      throw new CustomError({
        message:    'No tienes permisos para subir fotos de visitantes',
        statusCode: 403,
        errorCode:  GeneralErrorCode.FORBIDDEN,
      });
    }

    if (!file) {
      throw new BadRequestException('El campo photo es requerido');
    }

    const folder = this.storageService.buildFolder('visitors', 'photos');

    let publicId: string | undefined;
    try {
      const result = await this.storageService.uploadBuffer(
        file.buffer,
        folder,
        file.originalname,
      );
      publicId = result.publicId;

      const visitor = await this.visitorsService.updatePhotoUrl(visitorId, result.url);
      this.logger.log(`Foto subida para visitante ${visitorId}`);
      return { success: true, photoUrl: visitor.photoUrl };

    } catch (err: any) {
      if (publicId) {
        this.logger.warn(`Rollback R2: eliminando imagen huérfana ${publicId}`);
        await this.storageService.deleteByPublicId(publicId).catch(() => undefined);
      }
      throw err;
    }
  }
}
