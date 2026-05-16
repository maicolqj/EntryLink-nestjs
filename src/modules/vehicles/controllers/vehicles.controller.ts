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

import { VehiclesService }            from '../services/vehicles.service';
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
  ValidRoles.RESIDENT_ROL,
];

@Controller('vehicles')
@UseGuards(JwtRestGuard)
export class VehiclesController {
  private readonly logger = new Logger(VehiclesController.name);

  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly storageService:  R2StorageService,
  ) {}

  /**
   * POST /api/v1/vehicles/:vehicleId/photo
   *
   * Sube o reemplaza la foto de un vehículo en Cloudflare R2.
   * Body (multipart/form-data): photo — jpeg/png/webp/heic, máx 5 MB
   */
  @Post(':vehicleId/photo')
  @UseInterceptors(singleImageInterceptor('photo', { maxSizeMb: 5 }))
  async uploadPhoto(
    @Param('vehicleId') vehicleId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!currentUser.roles?.some(r => ALLOWED_ROLES.includes(r))) {
      throw new CustomError({
        message:    'No tienes permisos para subir fotos de vehículos',
        statusCode: 403,
        errorCode:  GeneralErrorCode.FORBIDDEN,
      });
    }

    if (!file) {
      throw new BadRequestException('El campo photo es requerido');
    }

    const folder = this.storageService.buildFolder('vehicles', 'photos');

    let publicId: string | undefined;
    try {
      const result = await this.storageService.uploadBuffer(
        file.buffer,
        folder,
        file.originalname,
      );
      publicId = result.publicId;

      const vehicle = await this.vehiclesService.updatePhotoUrl(vehicleId, result.url, currentUser);
      this.logger.log(`Foto subida para vehículo ${vehicleId}`);
      return { success: true, photoUrl: vehicle.photoUrl };

    } catch (err: any) {
      if (publicId) {
        this.logger.warn(`Rollback R2: eliminando imagen huérfana ${publicId}`);
        await this.storageService.deleteByPublicId(publicId).catch(() => undefined);
      }
      throw err;
    }
  }
}
