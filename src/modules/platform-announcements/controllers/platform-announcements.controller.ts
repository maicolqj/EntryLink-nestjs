import {
  Body,
  Controller,
  HttpStatus,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  MAX_ANNOUNCEMENT_IMAGES,
  PlatformAnnouncementsService,
} from '../services/platform-announcements.service';
import { SendPlatformAnnouncementDto } from '../dto/platform-announcement.inputs';
import { multipleImagesInterceptor } from '../../../core/infrastructure/r2/upload-interceptors';
import { Auth } from '../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { PlatformAnnouncementErrorCode } from '../../shared/constans/error-codes.constants';

@Controller('platform-announcements')
export class PlatformAnnouncementsController {
  constructor(
    private readonly announcementsService: PlatformAnnouncementsService,
  ) {}

  /**
   * POST /api/v1/platform-announcements
   *
   * Body (multipart/form-data):
   *   - payload : JSON con category, title, body, audience y target
   *   - files   : hasta 4 imágenes jpeg/png/webp/heic, máx 5 MB c/u (opcional)
   *
   * Carpeta R2: EntryLink/_platform/announcements
   */
  @Post()
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  @UseInterceptors(
    multipleImagesInterceptor('files', MAX_ANNOUNCEMENT_IMAGES, {
      maxSizeMb: 5,
    }),
  )
  async send(
    @Body('payload') rawPayload: string | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Req() req: Request,
  ) {
    const dto = await this.parsePayload(rawPayload);
    return this.announcementsService.send(
      dto,
      files ?? [],
      req.user as JwtAccessPayload,
    );
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
