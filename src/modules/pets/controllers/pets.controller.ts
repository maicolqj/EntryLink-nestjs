import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Param,
  Post,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';

import { PetsService } from '../services/pets.service';
import { PetIncidentsService } from '../services/pet-incidents.service';
import { RegisterPetDto } from '../dto/inputs/register-pet.input';
import { ReportPetIncidentDto } from '../dto/inputs/report-pet-incident.input';

import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import {
  multipleImagesInterceptor,
  singleImageInterceptor,
  singleDocumentInterceptor,
} from '../../../core/infrastructure/r2/upload-interceptors';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { PetErrorCode } from '../../shared/constans/error-codes.constants';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
/** Tope de fotos de evidencia por reporte. Coincide con el del interceptor. */
const MAX_EVIDENCE_FILES = 5;

/**
 * Todo lo que involucra archivos vive aquí: GraphQL en este proyecto no recibe
 * multipart. El resto del módulo (consultas, aprobación, sanciones) va por
 * GraphQL.
 */
@RequireModule(ComplexModule.MASCOTAS)
@Controller('pets')
export class PetsController {
  private readonly logger = new Logger(PetsController.name);

  constructor(
    private readonly petsService: PetsService,
    private readonly incidentsService: PetIncidentsService,
    private readonly storageService: R2StorageService,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * POST /api/v1/pets
   *
   * Registra la ficha con su foto en una sola operación. La foto es
   * obligatoria: una ficha sin foto no permite identificar a la mascota en un
   * reporte, que es la mitad de la razón por la que existe el censo.
   *
   * Body (multipart/form-data): los campos de RegisterPetDto + `photo`.
   * Carpeta R2: EntryLink/{complex-slug}/pets
   */
  @Post()
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
  })
  @UseInterceptors(singleImageInterceptor('photo', { maxSizeMb: 8 }))
  async registerPet(
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: RegisterPetDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!photo) {
      throw new CustomError({
        message: 'La foto de la mascota es obligatoria',
        statusCode: 400,
        errorCode: PetErrorCode.PET_PHOTO_REQUIRED,
      });
    }

    // Valida acceso al complejo ANTES de subir nada a R2.
    const complex = await this.complexService.findById(
      body.complexId,
      currentUser,
    );
    const folder = this.storageService.buildFolder(complex.slug, 'pets');

    let publicId: string | undefined;
    try {
      const uploaded = await this.storageService.uploadBuffer(
        photo.buffer,
        folder,
        photo.originalname,
      );
      publicId = uploaded.publicId;

      return await this.petsService.create(
        { ...body, photoUrl: uploaded.url },
        currentUser,
      );
    } catch (error) {
      // Rollback: si la ficha no quedó guardada, la foto no puede quedar viva.
      if (publicId) {
        this.logger.warn(`Rollback R2: eliminando foto huérfana ${publicId}`);
        await this.storageService
          .deleteByPublicId(publicId)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * POST /api/v1/pets/:petId/photo
   * Reemplaza la foto de una ficha existente.
   */
  @Post(':petId/photo')
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
  })
  @UseInterceptors(singleImageInterceptor('photo', { maxSizeMb: 8 }))
  async uploadPhoto(
    @Param('petId') petId: string,
    @UploadedFile() photo: Express.Multer.File,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!photo) {
      throw new BadRequestException('El campo photo es requerido');
    }

    // findById valida el acceso del usuario a esta mascota antes de subir nada.
    const pet = await this.petsService.findById(petId, currentUser);
    const complexSlug = await this.complexService.getSlugById(pet.complexId);
    const folder = this.storageService.buildFolder(complexSlug, 'pets');

    let publicId: string | undefined;
    try {
      const uploaded = await this.storageService.uploadBuffer(
        photo.buffer,
        folder,
        photo.originalname,
      );
      publicId = uploaded.publicId;

      const updated = await this.petsService.updatePhotoUrl(
        petId,
        uploaded.url,
        currentUser,
      );
      return { success: true, photoUrl: updated.photoUrl };
    } catch (error) {
      if (publicId) {
        await this.storageService
          .deleteByPublicId(publicId)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * POST /api/v1/pets/:petId/vaccination-card
   * Carné de vacunación en PDF. De aquí sale el aviso de refuerzo antirrábico.
   */
  @Post(':petId/vaccination-card')
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
  })
  @UseInterceptors(singleDocumentInterceptor('file', { maxSizeMb: 10 }))
  async uploadVaccinationCard(
    @Param('petId') petId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    if (!file) {
      throw new BadRequestException('El campo file es requerido');
    }

    const pet = await this.petsService.findById(petId, currentUser);
    const complexSlug = await this.complexService.getSlugById(pet.complexId);
    const folder = this.storageService.buildFolder(
      complexSlug,
      'pets',
      'health',
    );

    let publicId: string | undefined;
    try {
      const uploaded = await this.storageService.uploadBuffer(
        file.buffer,
        folder,
        file.originalname,
        'raw',
      );
      publicId = uploaded.publicId;

      const updated = await this.petsService.updateVaccinationCardUrl(
        petId,
        uploaded.url,
        currentUser,
      );
      return { success: true, vaccinationCardUrl: updated.vaccinationCardUrl };
    } catch (error) {
      if (publicId) {
        await this.storageService
          .deleteByPublicId(publicId)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * POST /api/v1/pets/incidents
   *
   * Radica un reporte con su evidencia fotográfica. Quien reporta no elige la
   * hora del sello: el servidor registra cuándo recibió cada archivo y guarda
   * el SHA-256 de la imagen. El EXIF del celular no vale como prueba —se
   * edita—; el hash sí demuestra que la foto del expediente es la que llegó.
   *
   * Carpeta R2: EntryLink/{complex-slug}/pets/incidents
   */
  @Post('incidents')
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
  })
  @UseInterceptors(multipleImagesInterceptor('files', MAX_EVIDENCE_FILES))
  async reportIncident(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: ReportPetIncidentDto,
    @Req() req: Request,
  ) {
    const currentUser = req.user as JwtAccessPayload;

    const complex = await this.complexService.findById(
      body.complexId,
      currentUser,
    );
    const folder = this.storageService.buildFolder(
      complex.slug,
      'pets',
      'incidents',
    );

    const uploadedPublicIds: string[] = [];
    const photoUrls: string[] = [];
    const photoHashes: string[] = [];

    try {
      for (const file of files ?? []) {
        // El hash se calcula sobre el buffer recibido, antes de que el archivo
        // salga hacia R2: es la huella de lo que realmente llegó al servidor.
        photoHashes.push(
          createHash('sha256').update(file.buffer).digest('hex'),
        );

        const uploaded = await this.storageService.uploadBuffer(
          file.buffer,
          folder,
          file.originalname,
        );
        uploadedPublicIds.push(uploaded.publicId);
        photoUrls.push(uploaded.url);
      }

      return await this.incidentsService.report(
        { ...body, photoUrls, photoHashes },
        currentUser,
      );
    } catch (error) {
      if (uploadedPublicIds.length > 0) {
        this.logger.warn(
          `Rollback R2: eliminando ${uploadedPublicIds.length} evidencia(s) por fallo al radicar`,
        );
        await Promise.allSettled(
          uploadedPublicIds.map((id) =>
            this.storageService.deleteByPublicId(id),
          ),
        );
      }
      throw error;
    }
  }
}
