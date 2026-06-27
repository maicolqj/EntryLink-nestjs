import {
  Controller,
  Post,
  Param,
  UploadedFile,
  UseInterceptors,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { R2StorageService }        from '../../../core/infrastructure/r2/r2.service';
import { singleImageInterceptor }  from '../../../core/infrastructure/r2/upload-interceptors';
import { CustomError } from '../../shared/utils/errors.utils';
import { AuthErrorCode, GeneralErrorCode, UserErrorCode } from '../../shared/constans/error-codes.constants';

@Controller('supervisors')
export class SupervisorsController {
  private readonly logger = new Logger(SupervisorsController.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly storageService: R2StorageService,
  ) {}

  /**
   * POST /api/v1/supervisors/:supervisorId/company-card
   *
   * Endpoint público (sin JWT). Sube la foto del carnet de empresa del supervisor
   * recién registrado, antes de que verifique su email.
   *
   * Protección: supervisorId debe existir y emailVerified = false
   * para evitar sobreescribir la imagen de un supervisor ya activo.
   */
  @Post(':supervisorId/company-card')
  @UseInterceptors(
    singleImageInterceptor('companyCard', {
      maxSizeMb:    5,
      allowedTypes: ['image/jpeg', 'image/png'],
    }),
  )
  async uploadCompanyCard(
    @Param('supervisorId') supervisorId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new CustomError({
        message: 'El campo companyCard es requerido',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.VALIDATION_ERROR,
      });
    }

    const user = await this.userRepo.findOne({ where: { id: supervisorId } });

    if (!user) {
      throw new CustomError({
        message: 'Supervisor no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (user.emailVerified) {
      throw new CustomError({
        message: 'No se puede modificar la imagen de un supervisor ya verificado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AuthErrorCode.ACCOUNT_ALREADY_VERIFIED,
      });
    }

    const result = await this.storageService.uploadBuffer(
      file.buffer,
      this.storageService.buildFolder('auth', 'company-cards'),
      file.originalname,
    );

    await this.userRepo.update(supervisorId, { companyCardUrl: result.url });

    this.logger.log(`company-card subida para supervisorId=${supervisorId}`);

    return { success: true, companyCardUrl: result.url };
  }
}
