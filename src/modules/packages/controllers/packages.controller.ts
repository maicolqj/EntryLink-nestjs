import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
  BadRequestException,
  Body,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';

import { PackagesService }           from '../services/packages.service';
import { RegisterPackageInput }      from '../dto/inputs/register-package.input';
import { PackageType }               from '../enums/package-type.enum';
import { CloudinaryService }         from '../../../core/infrastructure/cloudinary/cloudinary.service';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { JwtRestGuard }              from '../../shared/guards/jwt-rest.guard';
import { JwtAccessPayload }          from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }                from '../../roles/enums/valid-roles';
import { CustomError }               from '../../shared/utils/errors.utils';
import { GeneralErrorCode }          from '../../shared/constans/error-codes.constants';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_FILE_SIZE_MB   = 10;

@Controller('packages')
@UseGuards(JwtRestGuard)
export class PackagesController {
  private readonly logger = new Logger(PackagesController.name);

  constructor(
    private readonly packagesService:   PackagesService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly complexService:    ResidentialComplexService,
  ) {}

  /**
   * POST /api/v1/packages
   *
   * Registra un paquete y sube la foto a Cloudinary en la misma operación.
   *
   * Body (multipart/form-data):
   *   - unitId        : UUID de la unidad (requerido)
   *   - complexId     : UUID del complejo (requerido)
   *   - senderName    : nombre del remitente (requerido)
   *   - type          : PackageType (opcional, default PARCEL)
   *   - trackingCode  : código de rastreo (opcional)
   *   - description   : descripción del contenido (opcional)
   *   - recipientName : nombre del destinatario dentro de la unidad (opcional)
   *   - maxStorageDays: días máximos de almacenamiento (opcional)
   *   - notes         : notas adicionales (opcional)
   *   - photo         : archivo de imagen (opcional) — jpeg/png/webp/heic, máx 10 MB
   *
   * Ruta Cloudinary: entryLink/{complexSlug}/packages/{packageId}
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
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
  async registerPackage(
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: Record<string, string>,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    const allowedRoles: ValidRoles[] = [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
    ];
    if (!currentUser.roles?.some(r => allowedRoles.includes(r))) {
      throw new CustomError({
        message:    'No tienes permisos para registrar paquetes',
        statusCode: 403,
        errorCode:  GeneralErrorCode.FORBIDDEN,
      });
    }

    const input: RegisterPackageInput = {
      unitId:         body.unitId,
      complexId:      body.complexId,
      senderName:     body.senderName,
      type:           (body.type as PackageType) ?? PackageType.PARCEL,
      trackingCode:   body.trackingCode   || undefined,
      description:    body.description    || undefined,
      recipientName:  body.recipientName  || undefined,
      maxStorageDays: body.maxStorageDays ? parseInt(body.maxStorageDays, 10) : undefined,
      notes:          body.notes          || undefined,
    };

    // 1. Crear paquete en BD (sin foto todavía para obtener el ID)
    const pkg = await this.packagesService.register(input, currentUser);

    // 2. Subir foto si fue enviada
    if (!photo) return pkg;

    // Cloudinary path: entryLink/{complexSlug}/packages/{packageId}
    const complex = await this.complexService.findById(pkg.complexId, currentUser);
    const folder  = `entryLink/${complex.slug}/packages/${pkg.id}`;

    let cloudinaryPublicId: string | undefined;
    try {
      const result = await this.cloudinaryService.uploadBuffer(
        photo.buffer,
        folder,
        photo.originalname,
      );
      cloudinaryPublicId = result.publicId;

      // 3. Actualizar photoUrl en BD
      return await this.packagesService.updatePhotoUrl(pkg.id, result.url);

    } catch (err) {
      // Si la actualización en BD falló pero ya subimos la imagen → rollback
      if (cloudinaryPublicId) {
        this.logger.warn(`Rollback Cloudinary: eliminando imagen huérfana ${cloudinaryPublicId}`);
        await this.cloudinaryService.deleteByPublicId(cloudinaryPublicId).catch(() => undefined);
      }
      this.logger.error(`Error subiendo foto del paquete ${pkg.id}: ${err?.message}`);
      // Retornamos el paquete sin foto antes de propagar el error
      return pkg;
    }
  }
}
