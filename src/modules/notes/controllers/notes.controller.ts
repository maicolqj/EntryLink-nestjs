import {
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Req,
  Body,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

import { NotesService } from '../services/notes.service';
import { CreateNoteDto } from '../dto/inputs/create-note.input';
import { R2StorageService }           from '../../../core/infrastructure/r2/r2.service';
import { multipleImagesInterceptor }  from '../../../core/infrastructure/r2/upload-interceptors';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { SupervisorVisitService } from '../../supervisor-visits/services/supervisor-visit.service';
import { JwtRestGuard } from '../../shared/guards/jwt-rest.guard';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { Auth } from '../../shared/decorators/auth.decorator';

@Controller('notes')
export class NotesController {
  private readonly logger = new Logger(NotesController.name);

  constructor(
    private readonly notesService: NotesService,
    private readonly storageService: R2StorageService,
    private readonly complexService: ResidentialComplexService,
    private readonly supervisorVisitService: SupervisorVisitService,
  ) { }

  /**
   * POST /api/v1/notes
   *
   * Crea una nota y sube las imágenes a R2 en la misma operación.
   * Las imágenes SOLO se suben si el registro en BD es exitoso.
   * Si la BD falla después de subir imágenes → rollback automático en R2.
   *
   * Body (multipart/form-data):
   *   - title     : string (3–255 caracteres)
   *   - content   : string (mínimo 10 caracteres)
   *   - complexId : UUID del complejo
   *   - files     : imagen(es) opcional(es) — jpeg/png/webp/heic, máx 10 MB c/u, máx 10 archivos
   *
   * Carpeta R2: entryLink/{complex-slug}/notas
   */
  @Post()
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL, ValidRoles.SECURITY_ROL] })
  @UseInterceptors(multipleImagesInterceptor('files', 10))

  async createNote(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateNoteDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    // Solo SECURITY, SUPERVISOR, COMPLEX_ROL y SUPER_ADMIN pueden crear notas
    const allowedRoles: ValidRoles[] = [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ];
    if (!currentUser.roles?.some((r) => allowedRoles.includes(r))) {
      throw new CustomError({
        message: 'No tienes permisos para crear notas xxx',
        statusCode: 403,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // ── Validación de visita activa para SUPERVISOR_ROL ──────────
    // El supervisor debe tener check-in activo en el complejo y
    // su posición GPS debe estar dentro del perímetro configurado.
    let supervisorVisitId: string | undefined;
    if (currentUser.roles?.includes(ValidRoles.SUPERVISOR_ROL)) {
      supervisorVisitId = await this.supervisorVisitService.assertActiveVisitForNote(
        body.complexId,
        currentUser.sub,
        body.lat,
        body.lng,
      );
    }

    const complex = await this.complexService.findById(body.complexId, currentUser);
    const folder = this.storageService.buildFolder('notes', complex.slug);

    // ── Subir imágenes a R2 ──────────────────────────────
    // Guardamos los publicIds para hacer rollback si la BD falla
    const uploadedPublicIds: string[] = [];
    const imageUrls: string[] = [];

    try {
      for (const file of files ?? []) {
        const result = await this.storageService.uploadBuffer(
          file.buffer,
          folder,
          file.originalname,
        );
        uploadedPublicIds.push(result.publicId);
        imageUrls.push(result.url);
      }

      // ── Guardar nota en BD ────────────────────────────────────────
      // Si este paso falla, el catch elimina las imágenes de R2
      const note = await this.notesService.createNote(
        {
          complexId: body.complexId,
          title: body.title,
          content: body.content,
          imageUrls,
          createdByRole: currentUser.roles?.[0] ?? null,
          supervisorVisitId,
        },
        currentUser,
      );

      return note;

    } catch (error) {
      // ── Rollback: eliminar imágenes huérfanas de R2 ───────
      if (uploadedPublicIds.length > 0) {
        this.logger.warn(
          `Rollback R2: eliminando ${uploadedPublicIds.length} imagen(es) por fallo en BD`,
        );
        await Promise.allSettled(
          uploadedPublicIds.map((publicId) =>
            this.storageService.deleteByPublicId(publicId),
          ),
        );
      }
      throw error;
    }
  }
}
