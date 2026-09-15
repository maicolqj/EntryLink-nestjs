import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { MaintenanceVendor } from '../entities/maintenance-vendor.entity';
import { MaintenanceTicket } from '../entities/maintenance-ticket.entity';
import {
  CreateMaintenanceVendorInput,
  UpdateMaintenanceVendorInput,
} from '../dto/inputs/maintenance-vendor.inputs';
import { OPEN_TICKET_STATUSES } from '../utils/maintenance-status.util';

import { CustomError } from '../../shared/utils/errors.utils';
import { MaintenanceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { In } from 'typeorm';

/**
 * Directorio de proveedores externos del complejo.
 *
 * Vive aquí y no en finanzas porque lo que se necesita saber de ellos hoy es a
 * quién se le asigna una reparación, no cómo se le paga. Si mañana el gasto
 * quiere referenciarlos, referencia esta tabla.
 */
@Injectable()
export class MaintenanceVendorsService {
  private readonly logger = new Logger(MaintenanceVendorsService.name);

  constructor(
    @InjectRepository(MaintenanceVendor)
    private readonly vendorRepo: Repository<MaintenanceVendor>,
    @InjectRepository(MaintenanceTicket)
    private readonly ticketRepo: Repository<MaintenanceTicket>,
    private readonly complexService: ResidentialComplexService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    input: CreateMaintenanceVendorInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceVendor> {
    await this.complexService.findById(input.complexId, currentUser);

    if (input.legalId) {
      await this.assertLegalIdIsFree(input.complexId, input.legalId);
    }

    const vendor = await this.vendorRepo.save(
      this.vendorRepo.create({
        ...input,
        specialties: input.specialties ?? [],
        createdByUserId:
          currentUser.entityType === 'user' ? currentUser.sub : null,
      }),
    );

    void this.auditService.log({
      entityType: AuditEntityType.MaintenanceVendor,
      entityId: vendor.id,
      action: AuditAction.CREATE,
      newValue: { name: vendor.name, legalId: vendor.legalId },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: vendor.complexId,
      description: `Proveedor de mantenimiento creado: ${vendor.name}`,
    });

    return vendor;
  }

  async update(
    input: UpdateMaintenanceVendorInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceVendor> {
    const vendor = await this.findByIdOrFail(input.id);
    await this.complexService.findById(vendor.complexId, currentUser);

    if (input.legalId && input.legalId !== vendor.legalId) {
      await this.assertLegalIdIsFree(
        vendor.complexId,
        input.legalId,
        vendor.id,
      );
    }

    const previous = { name: vendor.name, isActive: vendor.isActive };

    Object.assign(vendor, {
      ...input,
      id: vendor.id,
      specialties: input.specialties ?? vendor.specialties,
    });

    const saved = await this.vendorRepo.save(vendor);

    void this.auditService.log({
      entityType: AuditEntityType.MaintenanceVendor,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: previous,
      newValue: { name: saved.name, isActive: saved.isActive },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Proveedor de mantenimiento actualizado: ${saved.name}`,
    });

    return saved;
  }

  /**
   * Baja lógica. Nunca borrado: los tickets que ese proveedor atendió el año
   * pasado siguen citándolo, y un historial que pierde el nombre de quien hizo
   * el trabajo no sirve para decidir si se le vuelve a contratar.
   */
  async deactivate(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceVendor> {
    const vendor = await this.findByIdOrFail(id);
    await this.complexService.findById(vendor.complexId, currentUser);

    const openTickets = await this.ticketRepo.count({
      where: {
        vendorId: vendor.id,
        status: In(OPEN_TICKET_STATUSES),
        deletedAt: IsNull(),
      },
    });

    if (openTickets > 0) {
      throw new CustomError({
        message: `El proveedor tiene ${openTickets} ticket(s) abiertos. Reasígnalos antes de desactivarlo`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_VENDOR_HAS_OPEN_TICKETS,
      });
    }

    vendor.isActive = false;
    vendor.deletedAt = new Date();

    return this.vendorRepo.save(vendor);
  }

  async findByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
    onlyActive = true,
  ): Promise<MaintenanceVendor[]> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    return this.vendorRepo.find({
      where: onlyActive
        ? { complexId, isActive: true, deletedAt: IsNull() }
        : { complexId, deletedAt: IsNull() },
      order: { name: 'ASC' },
    });
  }

  async findByIdOrFail(id: string): Promise<MaintenanceVendor> {
    const vendor = await this.vendorRepo.findOne({ where: { id } });

    if (!vendor) {
      throw new CustomError({
        message: `Proveedor con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MaintenanceErrorCode.MAINTENANCE_VENDOR_NOT_FOUND,
      });
    }

    return vendor;
  }

  private async assertLegalIdIsFree(
    complexId: string,
    legalId: string,
    exceptId?: string,
  ): Promise<void> {
    const normalized = legalId.replace(/[\s.-]/g, '');

    const existing = await this.vendorRepo.findOne({
      where: { complexId, legalId: normalized, deletedAt: IsNull() },
    });

    if (existing && existing.id !== exceptId) {
      throw new CustomError({
        message: `Ya existe un proveedor con el NIT ${legalId}: ${existing.name}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_VENDOR_DUPLICATE,
      });
    }
  }
}
