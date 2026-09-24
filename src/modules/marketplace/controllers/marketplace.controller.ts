import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { MarketplaceListingsService } from '../services/marketplace-listings.service';
import { MarketplaceChatService } from '../services/marketplace-chat.service';
import { CreateListingDto } from '../dto/inputs/create-listing.input';

import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import {
  multipleImagesInterceptor,
  singleImageInterceptor,
} from '../../../core/infrastructure/r2/upload-interceptors';
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
@RequireModule([ComplexModule.CLASIFICADOS, ComplexModule.SERVICIOS])
@Controller('marketplace')
export class MarketplaceController {
  private readonly logger = new Logger(MarketplaceController.name);

  constructor(
    private readonly listingsService: MarketplaceListingsService,
    private readonly storageService: R2StorageService,
    private readonly complexService: ResidentialComplexService,
    private readonly chatService: MarketplaceChatService,
  ) {}

  /**
   * POST /api/v1/marketplace/conversations/:conversationId/images
   *
   * Manda una foto por el chat. Body (multipart/form-data): `image`.
   * Carpeta R2: EntryLink/{complex-slug}/marketplace-chat/{conversationId}
   *
   * La foto NO se sirve por la URL pública del bucket: la llave queda en el
   * mensaje y solo sale por el GET de abajo, que valida quién la pide.
   */
  @Post('conversations/:conversationId/images')
  @Auth({ roles: PUBLISHER_ROLES })
  @UseInterceptors(singleImageInterceptor('image', { maxSizeMb: 8 }))
  async sendChatImage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @UploadedFile() image: Express.Multer.File,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!image) {
      throw new BadRequestException('El campo image es requerido');
    }

    // Antes de subir nada: participante, chat abierto y sin exceso de mensajes.
    const conversation = await this.chatService.assertCanSendImage(
      conversationId,
      currentUser,
    );
    const complexSlug = await this.complexService.getSlugById(
      conversation.complexId,
    );
    const folder = this.storageService.buildFolder(
      complexSlug,
      'marketplace-chat',
      conversationId,
    );

    const uploaded = await this.storageService.uploadBuffer(
      image.buffer,
      folder,
      image.originalname,
    );

    try {
      return await this.chatService.sendImage(
        conversationId,
        uploaded.publicId,
        currentUser,
      );
    } catch (error) {
      await this.cleanupUploads([uploaded.publicId]);
      throw error;
    }
  }

  /**
   * GET /api/v1/marketplace/conversations/:conversationId/messages/:messageId/image
   *
   * Sirve una foto del chat. Solo a los dos participantes, o a la
   * administración si la conversación fue reportada.
   */
  @Get('conversations/:conversationId/messages/:messageId/image')
  @Auth({ roles: PUBLISHER_ROLES })
  async getChatImage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = await this.chatService.resolveImageKey(
      conversationId,
      messageId,
      req.user as JwtAccessPayload,
    );

    const file = await this.storageService.getObjectStream(key);

    res.setHeader('Content-Type', file.contentType);
    if (file.length) res.setHeader('Content-Length', String(file.length));
    // Privada: ningún proxy ni CDN intermedio puede guardarla.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    file.stream.pipe(res);
  }

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
