import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { RegisterComplexDto } from '../dto/inputs/register-complex.dto';
import { ResidentialComplexService } from '../services/residential-complex.service';
import { ALLOWED_DOCUMENT_MIME_TYPES } from '../../../core/infrastructure/r2/upload-interceptors';

@Controller('complexes')
export class ResidentialComplexController {
  private readonly logger = new Logger(ResidentialComplexController.name);

  constructor(private readonly complexService: ResidentialComplexService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'rutFile', maxCount: 1 },
        { name: 'legalRepDocument', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 20 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          if (ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(new BadRequestException(`Formato no soportado: ${file.mimetype}. Solo se aceptan PDFs.`), false);
          }
        },
      },
    ),
  )
  async register(
    @UploadedFiles()
    files: { rutFile?: Express.Multer.File[]; legalRepDocument?: Express.Multer.File[] },
    @Body() body: RegisterComplexDto,
  ) {
    if (!files?.rutFile?.[0]) {
      throw new BadRequestException('El archivo RUT (rutFile) es obligatorio');
    }
    if (!files?.legalRepDocument?.[0]) {
      throw new BadRequestException('El documento del representante legal (legalRepDocument) es obligatorio');
    }

    return this.complexService.registerComplex(body, files.rutFile[0], files.legalRepDocument[0]);
  }
}
