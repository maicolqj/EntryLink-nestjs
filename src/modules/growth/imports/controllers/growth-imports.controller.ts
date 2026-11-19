import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { ValidPermissions as P } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthUploadImportDto } from '../dto/inputs/import.inputs';
import { ImportBatch } from '../entities/import.entities';
import { IMPORT_MAX_BYTES } from '../shared/file-reader';
import { ImportsService } from '../services/imports.service';

/**
 * Subida (multipart) y descarga del informe. El resto del flujo va por
 * GraphQL. El archivo se lee en memoria (máx. 5 MB) y no se guarda: ni en
 * disco, ni en la base, ni en R2. Solo quedan su sha256 y su tamaño.
 */
@Controller('growth/imports')
export class GrowthImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 10 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: GrowthUploadImportDto,
    @Request() req: { user: JwtAccessPayload },
  ): Promise<ImportBatch> {
    return this.imports.upload(file, body, req.user);
  }

  @Get(':id/report')
  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  async report(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() req: { user: JwtAccessPayload },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { fileName, content } = await this.imports.report(id, req.user);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(content);
  }
}
