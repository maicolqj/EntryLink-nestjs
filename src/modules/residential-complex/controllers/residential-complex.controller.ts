import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';

import { RegisterComplexDto } from '../dto/inputs/register-complex.dto';
import {
  RegistrationDocumentKind,
  ResidentialComplexService,
} from '../services/residential-complex.service';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { ALLOWED_DOCUMENT_MIME_TYPES } from '../../../core/infrastructure/r2/upload-interceptors';
import { JwtRestGuard } from '../../shared/guards/jwt-rest.guard';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/** Tope del PDF firmado, alineado con los documentos del registro. */
const MAX_SIGNED_DPA_MB = 20;

const REGISTRATION_DOCUMENTS: RegistrationDocumentKind[] = [
  'rut',
  'legal-rep',
  'signed-dpa',
];

@Controller('complexes')
export class ResidentialComplexController {
  private readonly logger = new Logger(ResidentialComplexController.name);

  constructor(
    private readonly complexService: ResidentialComplexService,
    private readonly storageService: R2StorageService,
  ) {}

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
            cb(
              new BadRequestException(
                `Formato no soportado: ${file.mimetype}. Solo se aceptan PDFs.`,
              ),
              false,
            );
          }
        },
      },
    ),
  )
  async register(
    @UploadedFiles()
    files: {
      rutFile?: Express.Multer.File[];
      legalRepDocument?: Express.Multer.File[];
    },
    @Body() body: RegisterComplexDto,
  ) {
    if (!files?.rutFile?.[0]) {
      throw new BadRequestException('El archivo RUT (rutFile) es obligatorio');
    }
    if (!files?.legalRepDocument?.[0]) {
      throw new BadRequestException(
        'El documento del representante legal (legalRepDocument) es obligatorio',
      );
    }

    return this.complexService.registerComplex(
      body,
      files.rutFile[0],
      files.legalRepDocument[0],
    );
  }

  /**
   * GET /api/v1/complexes/:id/registration-documents/:doc?download=1
   *
   * Sirve el RUT (`rut`) o el documento del representante legal (`legal-rep`)
   * que el complejo adjuntó al registrarse, o el DPA (Anexo B2B) que firmó
   * después (`signed-dpa`), en cualquier estado de revisión. Son datos
   * personales: los ven SUPER_ADMIN, el oficial de cumplimiento y la cuenta
   * del propio complejo (solo los suyos). El archivo lo transmite el backend,
   * sin entregar la URL de R2: la carpeta `documents/` no es pública.
   */
  @Get(':id/registration-documents/:doc')
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.COMPLEX_ROL,
    ],
  })
  async getRegistrationDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('doc') doc: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const currentUser = req.user as JwtAccessPayload;
    const isPlatformStaff = currentUser.roles?.some(
      (role) =>
        role === ValidRoles.SUPER_ADMIN_ROL ||
        role === ValidRoles.COMPILANCE_OFFICER_ROL,
    );
    // La cuenta del complejo lleva sub = complex.id (mismo criterio que la subida).
    if (!isPlatformStaff && (currentUser.complexId ?? currentUser.sub) !== id) {
      throw new ForbiddenException(
        'Solo puedes ver los documentos de tu propio complejo',
      );
    }

    if (!REGISTRATION_DOCUMENTS.includes(doc as RegistrationDocumentKind)) {
      throw new BadRequestException(
        `Documento no válido: usa ${REGISTRATION_DOCUMENTS.join(', ')}`,
      );
    }

    const { key, fileName } =
      await this.complexService.resolveRegistrationDocument(
        id,
        doc as RegistrationDocumentKind,
      );

    let file: Awaited<ReturnType<R2StorageService['getObjectStream']>>;
    try {
      file = await this.storageService.getObjectStream(key);
    } catch (err: any) {
      this.logger.warn(
        `Documento de registro ${doc} del complejo ${id} no está en R2: ${err?.message}`,
      );
      throw new NotFoundException(
        'El archivo no se encontró en el almacenamiento',
      );
    }

    const disposition = download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${fileName}"`,
    );
    if (file.length) res.setHeader('Content-Length', String(file.length));
    res.setHeader('Cache-Control', 'private, no-store');
    file.stream.pipe(res);
  }

  /**
   * POST /api/v1/complexes/me/signed-dpa
   *
   * El complejo autenticado sube su DPA (Anexo B2B) firmado.
   *
   * Body (multipart/form-data):
   *   - file: PDF firmado (requerido) — máx 20 MB
   *
   * Sustituye a la mutación GraphQL uploadSignedDpa, que viajaba en base64 y
   * chocaba contra el límite de 1 MB de express.json (el base64 engorda el
   * cuerpo un 33 %). La mutación se mantiene por compatibilidad.
   */
  @Post('me/signed-dpa')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRestGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIGNED_DPA_MB * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Formato no soportado: ${file.mimetype}. El DPA firmado debe ser un PDF.`,
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadSignedDpa(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo (file) es obligatorio');
    }

    const currentUser = req.user as JwtAccessPayload;
    if (!currentUser.roles?.includes(ValidRoles.COMPLEX_ROL)) {
      throw new ForbiddenException(
        'Solo la cuenta del complejo puede subir su DPA firmado',
      );
    }

    // La sesión de complejo lleva sub = complex.id; si viniera de un usuario con
    // complejo asociado, complexId manda. Mismo criterio que el resolver.
    const complexId = currentUser.complexId ?? currentUser.sub;

    return this.complexService.attachSignedDpaFile(
      complexId,
      file.buffer,
      file.originalname,
    );
  }
}
