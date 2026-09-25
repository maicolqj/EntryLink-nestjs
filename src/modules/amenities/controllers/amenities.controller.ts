import {
  Body,
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
import { createHash } from 'crypto';

import { AmenitiesService } from '../services/amenities.service';
import { AmenityBookingNoveltiesService } from '../services/amenity-booking-novelties.service';
import { CreateBookingNoveltyDto } from '../dto/inputs/create-booking-novelty.input';
import { readOptionalBoolean } from '../../pets/utils/pets-module.util';
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
/** Fotos por novedad de portería: las mismas que un reporte de daño. */
const MAX_NOVELTY_PHOTOS = 5;

@RequireModule(ComplexModule.ZONAS_COMUNES)
@Controller('amenities')
export class AmenitiesController {
  private readonly logger = new Logger(AmenitiesController.name);

  constructor(
    private readonly amenitiesService: AmenitiesService,
    private readonly noveltiesService: AmenityBookingNoveltiesService,
    private readonly storageService: R2StorageService,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * POST /api/v1/amenities/bookings/:bookingId/novelties
   *
   * Portería deja constancia de cómo recibe la zona: relato, si hay daño y
   * fotos. El SHA-256 de cada foto se calcula sobre el buffer recibido, antes
   * de salir hacia R2, y la hora es la del servidor. Cobrar el daño sigue
   * siendo de la administración (`chargeAmenityDamage`).
   *
   * Body (multipart/form-data): `description`, `hasDamage` + `files` (hasta 5).
   * Carpeta R2: EntryLink/{complex-slug}/amenities/novelties
   */
  @Post('bookings/:bookingId/novelties')
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.CHECK_IN_AMENITY_BOOKING],
  })
  @UseInterceptors(multipleImagesInterceptor('files', MAX_NOVELTY_PHOTOS))
  async createNovelty(
    @Param('bookingId') bookingId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateBookingNoveltyDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    // Acceso y estado ANTES de subir nada a R2.
    const booking = await this.noveltiesService.findBookingForNovelty(
      bookingId,
      currentUser,
    );
    const complex = await this.complexService.findById(
      booking.complexId,
      currentUser,
    );
    const folder = this.storageService.buildFolder(
      complex.slug,
      'amenities',
      'novelties',
    );

    const uploadedPublicIds: string[] = [];
    const photoUrls: string[] = [];
    const photoHashes: string[] = [];

    try {
      for (const file of files ?? []) {
        photoHashes.push(
          createHash('sha256').update(file.buffer).digest('hex'),
        );
        const uploaded = await this.storageService.uploadBuffer(
          file.buffer,
          folder,
          file.originalname,
        );
        uploadedPublicIds.push(uploaded.publicId);
        photoUrls.push(uploaded.url);
      }

      return await this.noveltiesService.create(
        {
          bookingId,
          description: body.description,
          hasDamage: readOptionalBoolean(body.hasDamage) === true,
          photoUrls,
          photoHashes,
        },
        currentUser,
      );
    } catch (err) {
      await Promise.allSettled(
        uploadedPublicIds.map((publicId) =>
          this.storageService.deleteByPublicId(publicId),
        ),
      );
      throw err;
    }
  }

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
