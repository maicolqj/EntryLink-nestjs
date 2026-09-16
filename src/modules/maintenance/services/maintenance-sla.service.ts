import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MaintenanceSlaConfig } from '../entities/maintenance-sla-config.entity';
import { MaintenanceCategory } from '../enums/maintenance-category.enum';
import { MaintenancePriority } from '../enums/maintenance-priority.enum';
import { UpsertMaintenanceSlaInput } from '../dto/inputs/upsert-maintenance-sla.input';

import { CustomError } from '../../shared/utils/errors.utils';
import { MaintenanceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';

/**
 * Horas de resolución por defecto cuando el complejo no configuró nada.
 *
 * Un módulo que exija llenar una matriz de doce categorías por cuatro
 * prioridades antes de recibir el primer ticket no lo estrena nadie. Estos
 * números salen de lo que un conjunto promedio puede sostener; el que quiera
 * otra cosa la configura y estos dejan de aplicar.
 */
const DEFAULT_RESOLUTION_HOURS: Record<MaintenancePriority, number> = {
  [MaintenancePriority.CRITICAL]: 4,
  [MaintenancePriority.HIGH]: 24,
  [MaintenancePriority.MEDIUM]: 72,
  [MaintenancePriority.LOW]: 168,
};

/**
 * Oficios que no esperan lo mismo que el resto aunque entren en la misma
 * prioridad: un escape de gas o un ascensor detenido son riesgo, no molestia.
 */
const CATEGORY_CEILING_HOURS: Partial<Record<MaintenanceCategory, number>> = {
  [MaintenanceCategory.GAS]: 4,
  [MaintenanceCategory.ASCENSORES]: 24,
  [MaintenanceCategory.SEGURIDAD]: 24,
};

@Injectable()
export class MaintenanceSlaService {
  constructor(
    @InjectRepository(MaintenanceSlaConfig)
    private readonly slaRepo: Repository<MaintenanceSlaConfig>,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * Horas comprometidas para este ticket. Devuelve un número siempre: un
   * ticket sin plazo es un ticket que nadie incumple nunca.
   */
  async resolveHours(
    complexId: string,
    category: MaintenanceCategory,
    priority: MaintenancePriority,
  ): Promise<number> {
    const config = await this.slaRepo.findOne({
      where: { complexId, category, priority },
    });

    if (config) return config.resolutionHours;

    const base = DEFAULT_RESOLUTION_HOURS[priority];
    const ceiling = CATEGORY_CEILING_HOURS[category];

    return ceiling ? Math.min(base, ceiling) : base;
  }

  /** Vencimiento a partir de un momento dado. */
  dueAtFrom(from: Date, hours: number): Date {
    return new Date(from.getTime() + hours * 3_600_000);
  }

  async findByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceSlaConfig[]> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    return this.slaRepo.find({
      where: { complexId },
      order: { category: 'ASC', priority: 'ASC' },
    });
  }

  async upsert(
    input: UpsertMaintenanceSlaInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceSlaConfig> {
    await this.complexService.findById(input.complexId, currentUser);

    if (input.responseHours > input.resolutionHours) {
      throw new CustomError({
        message:
          'El plazo para asignar no puede ser mayor que el plazo para resolver',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_SLA_INVALID,
      });
    }

    const existing = await this.slaRepo.findOne({
      where: {
        complexId: input.complexId,
        category: input.category,
        priority: input.priority,
      },
    });

    if (existing) {
      existing.responseHours = input.responseHours;
      existing.resolutionHours = input.resolutionHours;
      return this.slaRepo.save(existing);
    }

    return this.slaRepo.save(this.slaRepo.create(input));
  }

  async remove(id: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const config = await this.slaRepo.findOne({ where: { id } });

    if (!config) {
      throw new CustomError({
        message: 'La política de plazos no existe',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MaintenanceErrorCode.MAINTENANCE_SLA_NOT_FOUND,
      });
    }

    await this.complexService.findById(config.complexId, currentUser);
    await this.slaRepo.remove(config);

    // Los tickets vivos conservan su `slaHours`: se congeló al calcularlo, así
    // que borrar la política no le mueve el plazo a nadie que ya esté esperando.
    return true;
  }
}
