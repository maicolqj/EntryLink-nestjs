import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { DataExportService, ExportFile } from './data-export.service';
import { Auth } from '../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../roles/enums/valid-roles';

/**
 * Descargas de datos y reportes del complejo.
 *
 * Los archivos se generan al momento y se envían en la respuesta: no se
 * guardan en R2, porque el bucket es público y un respaldo trae documentos,
 * teléfonos y finanzas de todo el conjunto.
 */
@Controller('data-export')
export class DataExportController {
  constructor(private readonly dataExportService: DataExportService) {}

  /** Excel de un módulo: GET /data-export/:complexId/modules/:module?from=&to= */
  @Throttle({ short: { limit: 20, ttl: 60_000 } })
  @Get(':complexId/modules/:module')
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  async exportModule(
    @Param('complexId', new ParseUUIDPipe()) complexId: string,
    @Param('module') module: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req: { user: JwtAccessPayload },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const range = this.dataExportService.parseRange(from, to);
    const file = await this.dataExportService.exportModule(
      complexId,
      module.toUpperCase(),
      range,
      req.user,
    );
    return this.send(file, res);
  }

  /** ZIP con un Excel por módulo: GET /data-export/:complexId/backup?modules=A,B&from=&to= */
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @Get(':complexId/backup')
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  async exportBackup(
    @Param('complexId', new ParseUUIDPipe()) complexId: string,
    @Query('modules') modules: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req: { user: JwtAccessPayload },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const range = this.dataExportService.parseRange(from, to);
    const list = (modules ?? '')
      .split(',')
      .map((module) => module.trim().toUpperCase())
      .filter(Boolean);
    const file = await this.dataExportService.exportBackup(
      complexId,
      list,
      range,
      req.user,
    );
    return this.send(file, res);
  }

  private send(file: ExportFile, res: Response): StreamableFile {
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.buffer.length),
      // Datos personales: que ningún proxy ni el navegador los guarden.
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.buffer);
  }
}
