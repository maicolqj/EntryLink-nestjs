import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ComplexContact } from '../entities/complex-contact.entity';
import {
  CreateComplexContactInput,
  UpdateComplexContactInput,
} from '../dto/complex-info.inputs';
import { ComplexContactCategory } from '../enums/complex-info.enums';
import { ComplexInfoAccessService } from './complex-info-access.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexInfoErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

const CATEGORY_ORDER = Object.values(ComplexContactCategory);

function bySection(a: ComplexContact, b: ComplexContact): number {
  const byCategory =
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  if (byCategory !== 0) return byCategory;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, 'es');
}

/** Directorio de contactos de "Mi Conjunto". */
@Injectable()
export class ComplexContactsService {
  constructor(
    @InjectRepository(ComplexContact)
    private readonly contactRepo: Repository<ComplexContact>,
    private readonly access: ComplexInfoAccessService,
  ) {}

  async listAdmin(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<ComplexContact[]> {
    await this.access.assertAdmin(complexId, user);
    const contacts = await this.contactRepo.find({
      where: { complexId, deletedAt: IsNull() },
    });
    return contacts.sort(bySection);
  }

  /** Lo que ve el residente: solo los activos. Sin validar acceso: lo hace quien llama. */
  async listVisible(complexId: string): Promise<ComplexContact[]> {
    const contacts = await this.contactRepo.find({
      where: { complexId, isActive: true, deletedAt: IsNull() },
    });
    return contacts.sort(bySection);
  }

  async create(
    input: CreateComplexContactInput,
    user: JwtAccessPayload,
  ): Promise<ComplexContact> {
    await this.access.assertAdmin(input.complexId, user);
    const contact = this.contactRepo.create({
      ...input,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });
    this.assertReachable(contact);
    return this.contactRepo.save(contact);
  }

  async update(
    id: string,
    input: UpdateComplexContactInput,
    user: JwtAccessPayload,
  ): Promise<ComplexContact> {
    const contact = await this.findOrFail(id);
    await this.access.assertAdmin(contact.complexId, user);
    Object.assign(contact, input);
    this.assertReachable(contact);
    return this.contactRepo.save(contact);
  }

  async remove(id: string, user: JwtAccessPayload): Promise<boolean> {
    const contact = await this.findOrFail(id);
    await this.access.assertAdmin(contact.complexId, user);
    await this.contactRepo.softDelete(contact.id);
    return true;
  }

  private async findOrFail(id: string): Promise<ComplexContact> {
    const contact = await this.contactRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!contact) {
      throw new CustomError({
        message: 'Contacto no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexInfoErrorCode.COMPLEX_CONTACT_NOT_FOUND,
      });
    }
    return contact;
  }

  private assertReachable(contact: ComplexContact): void {
    if (!contact.phone?.trim() && !contact.email?.trim()) {
      throw new CustomError({
        message: 'El contacto necesita al menos un teléfono o un correo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ComplexInfoErrorCode.COMPLEX_CONTACT_UNREACHABLE,
      });
    }
  }
}
