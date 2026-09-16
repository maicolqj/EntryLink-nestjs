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
import { createHash } from 'node:crypto';

import { MaintenanceTicketsService } from '../services/maintenance-tickets.service';
import { CreateMaintenanceTicketDto } from '../dto/inputs/create-maintenance-ticket.input';
import { ResolveMaintenanceTicketDto } from '../dto/inputs/resolve-maintenance-ticket.input';
import { AddMaintenanceCommentInput } from '../dto/inputs/add-maintenance-comment.input';
import { readOptionalBoolean } from '../utils/maintenance-status.util';

import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import {
  imagesAndVideoInterceptor,
  multipleImagesInterceptor,
} from '../../../core/infrastructure/r2/upload-interceptors';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { MaintenanceErrorCode } from '../../shared/constans/error-codes.constants';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
const MAX_EVIDENCE_FILES = 5;
const MAX_IMAGE_MB = 10;
const MAX_VIDEO_MB = 40;

/** Cualquiera que esté dentro del conjunto puede reportar un daño común. */
const REPORTER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
  ValidRoles.RESIDENT_ROL,
  ValidRoles.COUNCIL_ROL,
];

/** Quien repara y sube la evidencia de cierre. */
const WORKER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
];

/**
 * Todo lo que involucra archivos vive aquí: GraphQL en este proyecto no recibe
 * multipart. El resto del módulo —tablero, asignación, mapa, calificación— va
 * por GraphQL.
 */
@RequireModule(ComplexModule.MANTENIMIENTO)
@Controller('maintenance')
export class MaintenanceController {
  private readonly logger = new Logger(MaintenanceController.name);

  constructor(
    private readonly ticketsService: MaintenanceTicketsService,
    private readonly storageService: R2StorageService,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * POST /api/v1/maintenance/tickets
   *
   * Radica el ticket con sus fotos y su video corto en una sola operación.
   * El sello de hora y el SHA-256 los pone el servidor: el EXIF del celular se
   * edita antes de subir, el hash del archivo recibido no.
   *
   * Body (multipart/form-data): los campos de CreateMaintenanceTicketDto +
   * `photos` (hasta 5) + `video` (uno).
   * Carpeta R2: EntryLink/{complex-slug}/maintenance
   */
  @Post('tickets')
  @Auth({ roles: REPORTER_ROLES })
  @UseInterceptors(
    imagesAndVideoInterceptor({
      imagesField: 'photos',
      videoField: 'video',
      maxImages: MAX_EVIDENCE_FILES,
      maxImageSizeMb: MAX_IMAGE_MB,
      maxVideoSizeMb: MAX_VIDEO_MB,
    }),
  )
  async createTicket(
    @UploadedFiles()
    files: { photos?: Express.Multer.File[]; video?: Express.Multer.File[] },
    @Body() body: CreateMaintenanceTicketDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;
    const photos = files?.photos ?? [];
    const video = files?.video?.[0];

    this.assertImageSizes(photos);

    // Valida acceso al complejo ANTES de subir nada a R2.
    const complex = await this.complexService.findById(
      body.complexId,
      currentUser,
    );
    const folder = this.storageService.buildFolder(complex.slug, 'maintenance');

    const uploadedIds: string[] = [];

    try {
      const photoUrls: string[] = [];
      const photoHashes: string[] = [];

      for (const photo of photos) {
        const uploaded = await this.storageService.uploadBuffer(
          photo.buffer,
          folder,
          photo.originalname,
        );
        uploadedIds.push(uploaded.publicId);
        photoUrls.push(uploaded.url);
        photoHashes.push(this.sha256(photo.buffer));
      }

      let videoUrl: string | null = null;
      let videoHash: string | null = null;

      if (video) {
        const uploaded = await this.storageService.uploadBuffer(
          video.buffer,
          folder,
          video.originalname,
          'raw',
        );
        uploadedIds.push(uploaded.publicId);
        videoUrl = uploaded.url;
        videoHash = this.sha256(video.buffer);
      }

      return await this.ticketsService.create(
        { ...body, photoUrls, photoHashes, videoUrl, videoHash },
        currentUser,
      );
    } catch (error) {
      await this.rollback(uploadedIds);
      throw error;
    }
  }

  /**
   * POST /api/v1/maintenance/tickets/:ticketId/resolve
   *
   * Cierre técnico con la foto del trabajo terminado. La foto es obligatoria:
   * sin ella "resuelto" es solo la palabra de quien tenía que arreglarlo.
   */
  @Post('tickets/:ticketId/resolve')
  @Auth({ roles: WORKER_ROLES })
  @UseInterceptors(
    multipleImagesInterceptor('photos', MAX_EVIDENCE_FILES, {
      maxSizeMb: MAX_IMAGE_MB,
    }),
  )
  async resolveTicket(
    @Param('ticketId') ticketId: string,
    @UploadedFiles() photos: Express.Multer.File[],
    @Body() body: ResolveMaintenanceTicketDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!photos?.length) {
      throw new CustomError({
        message: 'Adjunta al menos una foto de la reparación terminada',
        statusCode: 400,
        errorCode:
          MaintenanceErrorCode.MAINTENANCE_RESOLUTION_EVIDENCE_REQUIRED,
      });
    }

    // findByIdOrFail antes de subir: si el ticket no existe o ya está cerrado,
    // no tiene sentido dejar cinco fotos huérfanas en R2.
    const ticket = await this.ticketsService.findByIdOrFail(ticketId);
    const complexSlug = await this.complexService.getSlugById(ticket.complexId);
    const folder = this.storageService.buildFolder(
      complexSlug,
      'maintenance',
      'closures',
    );

    const uploadedIds: string[] = [];

    try {
      const photoUrls: string[] = [];
      const photoHashes: string[] = [];

      for (const photo of photos) {
        const uploaded = await this.storageService.uploadBuffer(
          photo.buffer,
          folder,
          photo.originalname,
        );
        uploadedIds.push(uploaded.publicId);
        photoUrls.push(uploaded.url);
        photoHashes.push(this.sha256(photo.buffer));
      }

      return await this.ticketsService.resolve(
        { ...body, ticketId, photoUrls, photoHashes },
        currentUser,
      );
    } catch (error) {
      await this.rollback(uploadedIds);
      throw error;
    }
  }

  /**
   * POST /api/v1/maintenance/tickets/:ticketId/progress
   *
   * Avance con fotos: "cambiamos la tarjeta, falta probar". Es lo que convierte
   * "en reparación" en algo que el residente puede leer.
   */
  @Post('tickets/:ticketId/progress')
  @Auth({
    roles: [...WORKER_ROLES, ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL],
  })
  @UseInterceptors(
    multipleImagesInterceptor('photos', MAX_EVIDENCE_FILES, {
      maxSizeMb: MAX_IMAGE_MB,
    }),
  )
  async addProgress(
    @Param('ticketId') ticketId: string,
    @UploadedFiles() photos: Express.Multer.File[],
    @Body() body: { message?: string; isInternal?: string },
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!body?.message?.trim()) {
      throw new BadRequestException('El campo message es requerido');
    }

    const ticket = await this.ticketsService.findByIdOrFail(ticketId);
    const complexSlug = await this.complexService.getSlugById(ticket.complexId);
    const folder = this.storageService.buildFolder(
      complexSlug,
      'maintenance',
      'progress',
    );

    const uploadedIds: string[] = [];

    try {
      const urls: string[] = [];
      const hashes: string[] = [];

      for (const photo of photos ?? []) {
        const uploaded = await this.storageService.uploadBuffer(
          photo.buffer,
          folder,
          photo.originalname,
        );
        uploadedIds.push(uploaded.publicId);
        urls.push(uploaded.url);
        hashes.push(this.sha256(photo.buffer));
      }

      const input: AddMaintenanceCommentInput = {
        ticketId,
        message: body.message.trim(),
        // En multipart todo llega como texto y `"false"` es una cadena no
        // vacía: sin convertirla, una nota pública quedaría marcada como
        // interna y el residente no la vería.
        isInternal: readOptionalBoolean(body.isInternal) ?? false,
      };

      return await this.ticketsService.addComment(input, currentUser, {
        urls,
        hashes,
      });
    } catch (error) {
      await this.rollback(uploadedIds);
      throw error;
    }
  }

  // ================================================================
  // HELPERS
  // ================================================================

  private sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Multer aplica un solo tope por petición —el del video, que es el mayor—,
   * así que el límite de las imágenes se revisa aquí.
   */
  private assertImageSizes(photos: Express.Multer.File[]): void {
    const oversized = photos.find(
      (photo) => photo.size > MAX_IMAGE_MB * 1024 * 1024,
    );

    if (oversized) {
      throw new BadRequestException(
        `La imagen ${oversized.originalname} supera los ${MAX_IMAGE_MB} MB`,
      );
    }
  }

  /** Si el ticket no quedó guardado, los archivos no pueden quedar vivos. */
  private async rollback(publicIds: string[]): Promise<void> {
    for (const publicId of publicIds) {
      this.logger.warn(`Rollback R2: eliminando archivo huérfano ${publicId}`);
      await this.storageService
        .deleteByPublicId(publicId)
        .catch(() => undefined);
    }
  }
}
