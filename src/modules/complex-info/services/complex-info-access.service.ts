import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { ResidentType } from '../../residents/enums/resident-type.enum';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ComplexDocumentAudience } from '../enums/complex-info.enums';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  ResidentErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/** Roles que administran "Mi Conjunto". */
export const COMPLEX_INFO_ADMIN_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
];

/**
 * Quién puede ver y quién puede administrar "Mi Conjunto".
 *
 * El residente se identifica por su ficha ACTIVA en el conjunto —nunca por un
 * id que mande la app—, igual que en "Mi unidad". Una persona puede tener
 * varias fichas (dueño de un apartamento, arrendatario en otro): es
 * propietaria si lo es en cualquiera de ellas.
 */
@Injectable()
export class ComplexInfoAccessService {
  constructor(
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
    private readonly complexService: ResidentialComplexService,
  ) {}

  isAdmin(user: JwtAccessPayload): boolean {
    return COMPLEX_INFO_ADMIN_ROLES.some((r) => user.roles.includes(r));
  }

  /** Administración del conjunto: SUPER_ADMIN o la cuenta del complejo. */
  async assertAdmin(complexId: string, user: JwtAccessPayload): Promise<void> {
    if (!this.isAdmin(user)) {
      throw new CustomError({
        message: 'Solo la administración gestiona Mi Conjunto',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
    await this.complexService.assertComplexAccess(complexId, user);
  }

  /** Fichas activas del residente en el conjunto; error si no tiene ninguna. */
  async myResidences(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<Resident[]> {
    const residences = await this.residentRepo.find({
      where: {
        userId: user.sub,
        complexId,
        status: ResidentStatus.ACTIVE,
        deletedAt: IsNull(),
      },
      relations: ['unit', 'unit.building'],
      order: { isMainResident: 'DESC', startDate: 'ASC' },
    });

    if (residences.length === 0) {
      throw new CustomError({
        message: 'No tienes una unidad activa en este conjunto',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ResidentErrorCode.RESIDENT_NOT_FOUND,
      });
    }
    return residences;
  }

  isOwner(residences: Resident[]): boolean {
    return residences.some((r) => r.type === ResidentType.OWNER);
  }

  canSee(audience: ComplexDocumentAudience, residences: Resident[]): boolean {
    return (
      audience === ComplexDocumentAudience.ALL_RESIDENTS ||
      this.isOwner(residences)
    );
  }

  /** Residentes activos a quienes va dirigido un documento. */
  audienceResidents(
    complexId: string,
    audience: ComplexDocumentAudience,
  ): Promise<Resident[]> {
    return this.residentRepo.find({
      where: {
        complexId,
        status: ResidentStatus.ACTIVE,
        deletedAt: IsNull(),
        ...(audience === ComplexDocumentAudience.OWNERS_ONLY
          ? { type: ResidentType.OWNER }
          : {}),
      },
      relations: ['unit', 'unit.building', 'user'],
    });
  }
}

/** "Torre 2 - 504", o solo "504" en conjuntos de casas sin torres. */
export function unitLabelOf(resident: Resident): string {
  const unit = resident.unit;
  if (!unit) return 'Unidad';
  return unit.building?.name
    ? `${unit.building.name} - ${unit.number}`
    : unit.number;
}
