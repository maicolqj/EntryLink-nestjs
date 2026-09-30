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

import { VehiclesService } from '../services/vehicles.service';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { singleImageInterceptor } from '../../../core/infrastructure/r2/upload-interceptors';
import { JwtRestGuard } from '../../shared/guards/jwt-rest.guard';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
const ALLOWED_ROLES: ValidRoles[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.RESIDENT_ROL,
];

@RequireModule(ComplexModule.VEHICULOS)
@Controller('vehicles')
@UseGuards(JwtRestGuard)
export class VehiclesController {
  private readonly logger = new Logger(VehiclesController.name);

  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly complexService: ResidentialComplexService,
    private readonly storageService: R2StorageService,
  ) {}

  /**
   * POST /api/v1/vehicles/:vehicleId/photo
   *
   * Sube o reemplaza la foto de un vehículo en Cloudflare R2.
   * Body (multipart/form-data): photo — jpeg/png/webp/heic, máx 5 MB
   *
   * Ruta R2: EntryLink/{complexSlug}/vehicles/photos
   */
  @Post(':vehicleId/photo')
  @UseInterceptors(singleImageInterceptor('photo', { maxSizeMb: 5 }))
  async uploadPhoto(
    @Param('vehicleId') vehicleId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!currentUser.roles?.some((r) => ALLOWED_ROLES.includes(r))) {
      throw new CustomError({
        message: 'No tienes permisos para subir fotos de vehículos',
        statusCode: 403,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    if (!file) {
      throw new BadRequestException('El campo photo es requerido');
    }

    // Se valida antes de subir nada a R2: la administración en cualquier
    // vehículo del conjunto, el residente solo en los de su unidad.
    const vehicleRecord = await this.vehiclesService.assertCanChangePhoto(
      vehicleId,
      currentUser,
    );
    const complexSlug = await this.complexService.getSlugById(
      vehicleRecord.complexId,
    );
    const folder = this.storageService.buildFolder(
      complexSlug,
      'vehicles',
      'photos',
    );

    let publicId: string | undefined;
    try {
      const result = await this.storageService.uploadBuffer(
        file.buffer,
        folder,
        file.originalname,
      );
      publicId = result.publicId;

      await this.vehiclesService.updatePhotoUrl(vehicleId, result.url);
      this.logger.log(`Foto subida para vehículo ${vehicleId}`);

      // La anterior deja de estar referenciada: se borra para no pagarla en R2.
      const previousKey = vehicleRecord.photoUrl
        ? this.storageService.keyFromPublicUrl(vehicleRecord.photoUrl)
        : null;
      if (previousKey && previousKey !== publicId) {
        this.storageService
          .deleteByPublicId(previousKey)
          .catch(() => undefined);
      }

      return { success: true, photoUrl: result.url };
    } catch (err: any) {
      if (publicId) {
        this.logger.warn(`Rollback R2: eliminando imagen huérfana ${publicId}`);
        await this.storageService
          .deleteByPublicId(publicId)
          .catch(() => undefined);
      }
      throw err;
    }
  }
}
