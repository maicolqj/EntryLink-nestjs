import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  MAX_ANNOUNCEMENT_ATTACHMENTS,
  MAX_ANNOUNCEMENT_ATTACHMENT_MB,
  MAX_ANNOUNCEMENT_IMAGES,
  PlatformAnnouncementsService,
} from '../services/platform-announcements.service';
import { SendPlatformAnnouncementDto } from '../dto/platform-announcement.inputs';
import { ALLOWED_IMAGE_MIME_TYPES } from '../../../core/infrastructure/r2/upload-interceptors';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { PlatformAnnouncementErrorCode } from '../../shared/constans/error-codes.constants';

/** Lo que se puede adjuntar: documentos de oficina, PDF, texto e imágenes. */
const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  ...ALLOWED_IMAGE_MIME_TYPES,
];

/**
 * Imágenes (`files`, se muestran en el cuerpo) y adjuntos (`attachments`, van
 * en el correo y se descargan desde el aviso) en la misma petición. Multer
 * aplica un solo tope por archivo; el servicio valida el de cada campo.
 */
const announcementFilesInterceptor = FileFieldsInterceptor(
  [
    { name: 'files', maxCount: MAX_ANNOUNCEMENT_IMAGES },
    { name: 'attachments', maxCount: MAX_ANNOUNCEMENT_ATTACHMENTS },
  ],
  {
    storage: memoryStorage(),
    limits: { fileSize: MAX_ANNOUNCEMENT_ATTACHMENT_MB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed =
        file.fieldname === 'files'
          ? ALLOWED_IMAGE_MIME_TYPES
          : ALLOWED_ATTACHMENT_MIME_TYPES;
      if (allowed.includes(file.mimetype)) cb(null, true);
      else
        cb(
          new BadRequestException(`Formato no soportado: ${file.mimetype}`),
          false,
        );
    },
  },
);

@Controller('platform-announcements')
export class PlatformAnnouncementsController {
  constructor(
    private readonly announcementsService: PlatformAnnouncementsService,
    private readonly storageService: R2StorageService,
  ) {}

  /**
   * POST /api/v1/platform-announcements
   *
   * Body (multipart/form-data):
   *   - payload     : JSON con category, title, body, audience, channels y target
   *   - files       : hasta 4 imágenes jpeg/png/webp/heic, máx 5 MB c/u (opcional)
   *   - attachments : hasta 5 archivos (PDF, Office, texto, imágenes), máx
   *                   10 MB c/u y 20 MB en total (opcional)
   *
   * Carpeta R2: EntryLink/_platform/announcements[/attachments]
   */
  @Post()
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  @UseInterceptors(announcementFilesInterceptor)
  async send(
    @Body('payload') rawPayload: string | undefined,
    @UploadedFiles()
    uploaded:
      | { files?: Express.Multer.File[]; attachments?: Express.Multer.File[] }
      | undefined,
    @Req() req: Request,
  ) {
    const dto = await this.parsePayload(rawPayload);
    return this.announcementsService.send(
      dto,
      uploaded?.files ?? [],
      uploaded?.attachments ?? [],
      req.user as JwtAccessPayload,
    );
  }

  /**
   * GET /api/v1/platform-announcements/:id/attachments/:index
   *
   * Descarga un adjunto. No tiene URL pública: lo entrega el backend al
   * personal de la plataforma o a quien recibió el comunicado.
   */
  @Get(':id/attachments/:index')
  @Auth()
  async downloadAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.announcementsService.resolveAttachment(
      id,
      index,
      req.user as JwtAccessPayload,
    );
    const file = await this.storageService.getObjectStream(attachment.key);

    // filename* (RFC 5987) para tildes y eñes; filename plano como respaldo.
    const ascii = attachment.name
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/"/g, '');
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    );
    if (file.length) res.setHeader('Content-Length', String(file.length));
    res.setHeader('Cache-Control', 'private, no-store');
    file.stream.pipe(res);
  }

  /** El multipart trae el comunicado como texto: se valida igual que un input. */
  private async parsePayload(
    raw: string | undefined,
  ): Promise<SendPlatformAnnouncementDto> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw ?? '');
    } catch {
      throw this.invalidPayload('El campo payload no es un JSON válido');
    }

    const dto = plainToInstance(SendPlatformAnnouncementDto, parsed);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      const detail = errors
        .flatMap((e) => [
          ...Object.values(e.constraints ?? {}),
          ...(e.children ?? []).flatMap((c) =>
            Object.values(c.constraints ?? {}),
          ),
        ])
        .join('; ');
      throw this.invalidPayload(`Comunicado inválido: ${detail}`);
    }

    return dto;
  }

  private invalidPayload(message: string): CustomError {
    return new CustomError({
      message,
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_INVALID_PAYLOAD,
    });
  }
}
