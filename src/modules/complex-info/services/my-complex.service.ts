import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { MyComplexInfoResponse } from '../dto/complex-info.responses';
import { ComplexInfoAccessService } from './complex-info-access.service';
import { ComplexDocumentsService } from './complex-documents.service';
import { ComplexContactsService } from './complex-contacts.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/**
 * "Mi Conjunto" del residente en una sola consulta: los datos del conjunto,
 * el directorio de contactos y los documentos publicados para él.
 */
@Injectable()
export class MyComplexService {
  constructor(
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    private readonly access: ComplexInfoAccessService,
    private readonly documentsService: ComplexDocumentsService,
    private readonly contactsService: ComplexContactsService,
  ) {}

  async find(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<MyComplexInfoResponse> {
    // Primero la ficha: sin ella no se entrega nada del conjunto.
    await this.access.myResidences(complexId, user);

    const [complex, contacts, docs] = await Promise.all([
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
        ],
      }),
      this.contactsService.listVisible(complexId),
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
      contacts,
      documents: docs.documents,
      pendingAcknowledgements: docs.pending,
    };
  }
}
