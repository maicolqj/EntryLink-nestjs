import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';

import { MarketplaceListingsService } from '../services/marketplace-listings.service';
import { CreateListingDto } from '../dto/inputs/create-listing.input';

import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { multipleImagesInterceptor } from '../../../core/infrastructure/r2/upload-interceptors';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

/** Tope duro del interceptor. El tope real lo pone cada conjunto en sus ajustes. */
const MAX_IMAGES = 10;

const PUBLISHER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.RESIDENT_ROL,
  ValidRoles.COUNCIL_ROL,
];

/**
 * Todo lo que lleva archivos vive aquí: GraphQL en este proyecto no recibe
 * multipart. El resto del módulo —consultas, moderación, reportes— va por
 * GraphQL.
 */
@RequireModule(ComplexModule.CLASIFICADOS)
@Controller('marketplace')
export class MarketplaceController {
  private readonly logger = new Logger(MarketplaceController.name);

  constructor(
    private readonly listingsService: MarketplaceListingsService,
    private readonly storageService: R2StorageService,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * POST /api/v1/marketplace/listings
   *
   * Publica el aviso con sus fotos en una sola operación.
   *
   * Body (multipart/form-data): los campos de CreateListingDto + `images`.
   * Carpeta R2: EntryLink/{complex-slug}/marketplace
   */
  @Post('listings')
  @Auth({ roles: PUBLISHER_ROLES })
  @UseInterceptors(
    multipleImagesInterceptor('images', MAX_IMAGES, { maxSizeMb: 8 }),
  )
  async createListing(
    @UploadedFiles() images: Express.Multer.File[],
    @Body() body: CreateListingDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    // Valida el acceso al complejo ANTES de subir nada a R2: subir primero y
    // preguntar después deja fotos huérfanas pagando almacenamiento.
    const complex = await this.complexService.findById(
      body.complexId,
      currentUser,
    );
    const folder = this.storageService.buildFolder(complex.slug, 'marketplace');

    const uploadedIds: string[] = [];

    try {
      const imageUrls: string[] = [];

      for (const image of images ?? []) {
        const uploaded = await this.storageService.uploadBuffer(
          image.buffer,
          folder,
          image.originalname,
        );
        uploadedIds.push(uploaded.publicId);
        imageUrls.push(uploaded.url);
      }

      return await this.listingsService.create(
        { ...body, imageUrls },
        currentUser,
      );
    } catch (error) {
      // Rollback: si el aviso no quedó guardado, las fotos no pueden quedar
      // vivas. Se borran todas, no solo la última: el alta sube varias.
      await this.cleanupUploads(uploadedIds);
      throw error;
    }
  }

  /**
   * POST /api/v1/marketplace/listings/:listingId/images
   * Agrega fotos a un aviso existente.
   */
  @Post('listings/:listingId/images')
  @Auth({ roles: PUBLISHER_ROLES })
  @UseInterceptors(
    multipleImagesInterceptor('images', MAX_IMAGES, { maxSizeMb: 8 }),
  )
  async addImages(
    @Param('listingId') listingId: string,
    @UploadedFiles() images: Express.Multer.File[],
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!images?.length) {
      throw new BadRequestException('El campo images es requerido');
    }

    // findById valida que quien sube tenga acceso a esta publicación.
    const listing = await this.listingsService.findById(listingId, currentUser);
    const complexSlug = await this.complexService.getSlugById(
      listing.complexId,
    );
    const folder = this.storageService.buildFolder(complexSlug, 'marketplace');

    const uploadedIds: string[] = [];

    try {
      const imageUrls: string[] = [];

      for (const image of images) {
        const uploaded = await this.storageService.uploadBuffer(
          image.buffer,
          folder,
          image.originalname,
        );
        uploadedIds.push(uploaded.publicId);
        imageUrls.push(uploaded.url);
      }

      const updated = await this.listingsService.appendImages(
        listingId,
        imageUrls,
        currentUser,
      );

      return { success: true, imageUrls: updated.imageUrls };
    } catch (error) {
      await this.cleanupUploads(uploadedIds);
      throw error;
    }
  }

  private async cleanupUploads(publicIds: string[]): Promise<void> {
    if (publicIds.length === 0) return;

    this.logger.warn(
      `Rollback R2: eliminando ${publicIds.length} foto(s) huérfana(s) de clasificados`,
    );

    await Promise.all(
      publicIds.map((publicId) =>
        this.storageService.deleteByPublicId(publicId).catch(() => undefined),
      ),
    );
  }
}
