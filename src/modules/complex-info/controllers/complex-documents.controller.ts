import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { ComplexDocumentsService } from '../services/complex-documents.service';
import { COMPLEX_INFO_ADMIN_ROLES } from '../services/complex-info-access.service';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { singleDocumentInterceptor } from '../../../core/infrastructure/r2/upload-interceptors';
import { Auth } from '../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/** Tope del PDF: un manual escaneado pesa; más de esto no se lee en un celular. */
const MAX_PDF_MB = 25;

/**
 * PDFs de "Mi Conjunto". Van por REST y no por GraphQL: un PDF en base64 infla
 * un 33 % el cuerpo y choca con el límite de GraphQL.
 */
@Controller('complex-documents')
export class ComplexDocumentsController {
  constructor(
    private readonly documentsService: ComplexDocumentsService,
    private readonly storageService: R2StorageService,
  ) {}

  /**
   * POST /api/v1/complex-documents/:id/file?notify=false
   *
   * Adjunta o reemplaza el PDF. Si el documento ya está publicado sube la
   * versión y avisa a los residentes, salvo `notify=false`.
   * Body (multipart/form-data): `file` — PDF, máx. 25 MB.
   */
  @Post(':id/file')
  @Auth({ roles: COMPLEX_INFO_ADMIN_ROLES })
  @UseInterceptors(singleDocumentInterceptor('file', { maxSizeMb: MAX_PDF_MB }))
  async uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('notify') notify: string | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('El campo file es requerido');
    return this.documentsService.attachFile(
      id,
      file,
      req.user as JwtAccessPayload,
      notify !== 'false',
    );
  }

  /**
   * GET /api/v1/complex-documents/:id/file?download=1
   *
   * Sirve el PDF. El archivo no tiene URL pública: el backend valida quién
   * pide (administración, o residente al que va dirigido) y lo transmite.
   */
  @Get(':id/file')
  @Auth({ roles: [...COMPLEX_INFO_ADMIN_ROLES, ValidRoles.RESIDENT_ROL] })
  async getFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { key, fileName } = await this.documentsService.resolveFile(
      id,
      req.user as JwtAccessPayload,
    );
    const file = await this.storageService.getObjectStream(key);

    const disposition = download ? 'attachment' : 'inline';
    // filename* (RFC 5987) para tildes y eñes; filename plano como respaldo.
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    if (file.length) res.setHeader('Content-Length', String(file.length));
    res.setHeader('Cache-Control', 'private, no-store');
    file.stream.pipe(res);
  }
}
