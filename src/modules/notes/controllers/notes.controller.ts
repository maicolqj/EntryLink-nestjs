import {
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Req,
  BadRequestException,
  Body,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';

import { NotesService }              from '../services/notes.service';
import { CreateNoteDto }             from '../dto/inputs/create-note.input';
import { CloudinaryService }         from '../../../core/infrastructure/cloudinary/cloudinary.service';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { JwtRestGuard }              from '../../shared/guards/jwt-rest.guard';
import { JwtAccessPayload }          from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }                from '../../roles/enums/valid-roles';
import { CustomError }               from '../../shared/utils/errors.utils';
import { GeneralErrorCode }          from '../../shared/constans/error-codes.constants';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_FILE_SIZE_MB   = 10;
const MAX_FILES          = 10;

@Controller('notes')
@UseGuards(JwtRestGuard)
export class NotesController {
  private readonly logger = new Logger(NotesController.name);

  constructor(
    private readonly notesService:     NotesService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly complexService:   ResidentialComplexService,
  ) {}

  /**
   * POST /api/v1/notes
   *
   * Crea una nota y sube las imágenes a Cloudinary en la misma operación.
   * Las imágenes SOLO se suben si el registro en BD es exitoso.
   * Si la BD falla después de subir imágenes → rollback automático en Cloudinary.
   *
   * Body (multipart/form-data):
   *   - title     : string (3–255 caracteres)
   *   - content   : string (mínimo 10 caracteres)
   *   - complexId : UUID del complejo
   *   - files     : imagen(es) opcional(es) — jpeg/png/webp/heic, máx 10 MB c/u, máx 10 archivos
   *
   * Carpeta Cloudinary: entryLink/{complex-slug}/notas
   */
  @Post()
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: memoryStorage(),
      limits:  { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Formato no soportado: ${file.mimetype}. Permitidos: jpeg, png, webp, heic`,
            ),
            false,
          );
        }
      },
    }),
  )
  async createNote(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateNoteDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    // Solo SECURITY, SUPERVISOR y SUPER_ADMIN pueden crear notas
    const allowedRoles: ValidRoles[] = [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ];
    if (!currentUser.roles?.some((r) => allowedRoles.includes(r))) {
      throw new CustomError({
        message:    'No tienes permisos para crear notas',
        statusCode: 403,
        errorCode:  GeneralErrorCode.FORBIDDEN,
      });
    }

    // Obtener complejo → el slug define la carpeta en Cloudinary
    const complex = await this.complexService.findById(body.complexId, currentUser);
    const folder  = `entryLink/${complex.slug}/notas`;

    // ── Subir imágenes a Cloudinary ──────────────────────────────
    // Guardamos los publicIds para hacer rollback si la BD falla
    const uploadedPublicIds: string[] = [];
    const imageUrls: string[]         = [];

    try {
      for (const file of files ?? []) {
        const result = await this.cloudinaryService.uploadBuffer(
          file.buffer,
          folder,
          file.originalname,
        );
        uploadedPublicIds.push(result.publicId);
        imageUrls.push(result.url);
      }

      // ── Guardar nota en BD ────────────────────────────────────────
      // Si este paso falla, el catch elimina las imágenes de Cloudinary
      const note = await this.notesService.createNote(
        {
          complexId:     body.complexId,
          title:         body.title,
          content:       body.content,
          imageUrls,
          createdByRole: currentUser.roles?.[0] ?? null,
        },
        currentUser,
      );

      return note;

    } catch (error) {
      // ── Rollback: eliminar imágenes huérfanas de Cloudinary ───────
      if (uploadedPublicIds.length > 0) {
        this.logger.warn(
          `Rollback Cloudinary: eliminando ${uploadedPublicIds.length} imagen(es) por fallo en BD`,
        );
        await Promise.allSettled(
          uploadedPublicIds.map((publicId) =>
            this.cloudinaryService.deleteByPublicId(publicId),
          ),
        );
      }
      throw error;
    }
  }
}
