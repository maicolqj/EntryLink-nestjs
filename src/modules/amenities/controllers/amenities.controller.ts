import {
  Controller,
  Post,
  Param,
  UploadedFiles,
  UseInterceptors,
  Req,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';

import { AmenitiesService } from '../services/amenities.service';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { multipleImagesInterceptor } from '../../../core/infrastructure/r2/upload-interceptors';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
/** Tope de fotos que puede acumular una zona. Coincide con el ArrayMaxSize del input. */
const MAX_IMAGES_PER_AMENITY = 10;

@RequireModule(ComplexModule.ZONAS_COMUNES)
@Controller('amenities')
export class AmenitiesController {
  private readonly logger = new Logger(AmenitiesController.name);

  constructor(
    private readonly amenitiesService: AmenitiesService,
    private readonly storageService: R2StorageService,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * POST /api/v1/amenities/:amenityId/images
   *
   * Sube fotos de la zona a R2 y las agrega a `imageUrls`. Va por REST porque
   * GraphQL en este proyecto no recibe multipart.
   *
   * Body (multipart/form-data):
   *   - files : imagen(es) jpeg/png/webp/heic, máx 10 MB c/u
   *
   * Carpeta R2: EntryLink/{complex-slug}/amenities
   */
  @Post(':amenityId/images')
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_AMENITIES],
  })
  @UseInterceptors(multipleImagesInterceptor('files', MAX_IMAGES_PER_AMENITY))
  async uploadImages(
    @Param('amenityId') amenityId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!files?.length) {
      throw new CustomError({
        message: 'No se recibió ninguna imagen',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    const amenity = await this.amenitiesService.findById(
      amenityId,
      currentUser,
    );
    const complex = await this.complexService.findById(
      amenity.complexId,
      currentUser,
    );

    const current = amenity.imageUrls ?? [];
    if (current.length + files.length > MAX_IMAGES_PER_AMENITY) {
      throw new CustomError({
        message: `La zona no puede superar ${MAX_IMAGES_PER_AMENITY} imágenes (tiene ${current.length})`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    const folder = this.storageService.buildFolder(complex.slug, 'amenities');

    // Si la actualización en BD falla, las imágenes recién subidas se borran:
    // dejarlas huérfanas en R2 es basura que nadie vuelve a mirar.
    const uploadedPublicIds: string[] = [];
    const uploadedUrls: string[] = [];

    try {
      for (const file of files) {
        const result = await this.storageService.uploadBuffer(
          file.buffer,
          folder,
          file.originalname,
        );
        uploadedPublicIds.push(result.publicId);
        uploadedUrls.push(result.url);
      }

      const updated = await this.amenitiesService.update(
        { id: amenityId, imageUrls: [...current, ...uploadedUrls] },
        currentUser,
      );

      return { id: updated.id, imageUrls: updated.imageUrls };
    } catch (err) {
      await Promise.allSettled(
        uploadedPublicIds.map((publicId) =>
          this.storageService.deleteByPublicId(publicId),
        ),
      );
      this.logger.error(
        `Error al subir imágenes de la zona ${amenityId}; rollback en R2 ejecutado`,
      );
      throw err;
    }
  }
}
