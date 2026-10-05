import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import {
  ComplexInfoSettings,
  MyComplexInfoResponse,
} from '../dto/complex-info.responses';
import { UpdateComplexInfoSettingsInput } from '../dto/complex-info.inputs';
import { ComplexInfoAccessService } from './complex-info-access.service';
import { ComplexDocumentsService } from './complex-documents.service';
import { ComplexContactsService } from './complex-contacts.service';
import { ComplexSchedulesService } from './complex-schedules.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/**
 * "Mi Conjunto" del residente en una sola consulta: los datos del conjunto,
 * el directorio de contactos, los horarios y los documentos publicados para él.
 */
@Injectable()
export class MyComplexService {
  constructor(
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    private readonly access: ComplexInfoAccessService,
    private readonly documentsService: ComplexDocumentsService,
    private readonly contactsService: ComplexContactsService,
    private readonly schedulesService: ComplexSchedulesService,
  ) {}

  async find(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<MyComplexInfoResponse> {
    // Primero la ficha: sin ella no se entrega nada del conjunto.
    await this.access.myResidences(complexId, user);

    const [complex, contacts, schedules, docs] = await Promise.all([
      this.complexRepo.findOne({
        where: { id: complexId, deletedAt: IsNull() },
        select: [
          'id',
          'name',
          'description',
          'address',
          'city',
          'state',
          'phoneNumber',
          'email',
          'website',
          'nit',
          'logoUrl',
          'myComplexShowCall',
          'myComplexShowEmail',
          'myComplexShowDirections',
          'myComplexShowWebsite',
        ],
      }),
      this.contactsService.listVisible(complexId),
      this.schedulesService.listVisible(complexId),
      this.documentsService.listForResident(complexId, user),
    ]);

    if (!complex) {
      throw new CustomError({
        message: 'Conjunto no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }

    return {
      complex,
      settings: toSettings(complex),
      contacts,
      schedules,
      documents: docs.documents,
      pendingAcknowledgements: docs.pending,
    };
  }

  /** Los botones que muestra la app, para el formulario de la administración. */
  async getSettings(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<ComplexInfoSettings> {
    await this.access.assertAdmin(complexId, user);
    return toSettings(await this.findComplexOrFail(complexId));
  }

  async updateSettings(
    complexId: string,
    input: UpdateComplexInfoSettingsInput,
    user: JwtAccessPayload,
  ): Promise<ComplexInfoSettings> {
    await this.access.assertAdmin(complexId, user);
    const patch: Partial<ResidentialComplex> = {};
    if (input.showCall !== undefined) patch.myComplexShowCall = input.showCall;
    if (input.showEmail !== undefined)
      patch.myComplexShowEmail = input.showEmail;
    if (input.showDirections !== undefined) {
      patch.myComplexShowDirections = input.showDirections;
    }
    if (input.showWebsite !== undefined) {
      patch.myComplexShowWebsite = input.showWebsite;
    }
    if (Object.keys(patch).length) {
      await this.complexRepo.update(complexId, patch);
    }
    return toSettings(await this.findComplexOrFail(complexId));
  }

  private async findComplexOrFail(
    complexId: string,
  ): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId, deletedAt: IsNull() },
      select: [
        'id',
        'myComplexShowCall',
        'myComplexShowEmail',
        'myComplexShowDirections',
        'myComplexShowWebsite',
      ],
    });
    if (!complex) {
      throw new CustomError({
        message: 'Conjunto no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }
    return complex;
  }
}

function toSettings(complex: ResidentialComplex): ComplexInfoSettings {
  return {
    showCall: complex.myComplexShowCall,
    showEmail: complex.myComplexShowEmail,
    showDirections: complex.myComplexShowDirections,
    showWebsite: complex.myComplexShowWebsite,
  };
}
