import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Package }                  from '../entities/package.entity';
import { PackageStatus }            from '../enums/package-status.enum';
import { RegisterPackageInput }     from '../dto/inputs/register-package.input';
import { ConfirmDeliveryInput }     from '../dto/inputs/confirm-delivery.input';
import { FilterPackagesInput }      from '../dto/inputs/filter-packages.input';
import { PaginatedPackagesResponse } from '../dto/responses/paginated-packages.response';

import { PaginationInput }           from '../../shared/dto/inputs/pagination.input';
import { CustomError }               from '../../shared/utils/errors.utils';
import { GeneralErrorCode, LogisticsErrorCode, ComplexErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }          from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService }               from '../../residential-complex/services/unit.service';
import { ResidentsService }          from '../../residents/services/residents.service';
import { NotificationsService }      from '../../notifications/services/notifications.service';
import { NotificationType }          from '../../notifications/enums/notification-type.enum';
import { NotificationPriority }      from '../../notifications/enums/notification-priority.enum';
import { SocketService }             from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent }               from '../../../core/infrastructure/socket/socket.events';
import { CacheService }              from '../../../core/infrastructure/cache/cache.service';
import { BK, filterKey }             from '../../../core/infrastructure/cache/business-cache.constants';

@Injectable()
export class PackagesService {
  private readonly logger = new Logger(PackagesService.name);

  constructor(
    @InjectRepository(Package)
    private readonly packageRepo: Repository<Package>,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly socketService: SocketService,
    private readonly cacheService: CacheService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // MUTATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Registra un paquete recibido en portería.
   * Estado inicial: RECEIVED → luego se marca NOTIFIED cuando se avisa al residente.
   */
  async register(
    input: RegisterPackageInput,
    currentUser: JwtAccessPayload,
  ): Promise<Package> {
    const { complexId, unitId } = input;

    // Validar acceso al complejo (lanza si no existe o no tiene acceso)
    await this.complexService.findById(complexId, currentUser);

    // Validar que la unidad existe y pertenece al complejo
    const unit = await this.unitService.findById(unitId, currentUser);
    if (unit.complexId !== complexId) {
      throw new CustomError({
        message: 'Unidad no encontrada en este complejo',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.UNIT_NOT_FOUND,
      });
    }

    const pkg = this.packageRepo.create({
      ...input,
      status: PackageStatus.RECEIVED,
      registeredByUserId: currentUser.entityType === 'user' ? currentUser.sub : undefined,
    });

    const saved = await this.packageRepo.save(pkg);
    await this.cacheService.deleteByPrefix(BK.pkg.prefix(saved.complexId));

    this.socketService.emitToComplex(saved.complexId, SocketEvent.PACKAGE_REGISTERED, {
      packageId: saved.id,
      unitId: saved.unitId,
      senderName: saved.senderName,
      trackingCode: saved.trackingCode,
    });

    this.notifyResidents(saved).catch(err =>
      this.logger.warn(`Error al notificar paquete ${saved.id}: ${err?.message}`),
    );

    return saved;
  }

  /** Dispara notificaciones a los residentes activos de la unidad (fire & forget) */
  private async notifyResidents(pkg: Package): Promise<void> {
    const residents = await this.residentsService.findActiveByUnitInternal(pkg.unitId);
    for (const resident of residents) {
      await this.notificationsService.create({
        type:            NotificationType.PACKAGE_RECEIVED,
        priority:        NotificationPriority.NORMAL,
        title:           '📦 Tienes un paquete en portería',
        body:            `Llegó un paquete de ${pkg.senderName}. Puedes retirarlo en portería.`,
        complexId:       pkg.complexId,
        recipientUserId: resident.userId,
        entityId:        pkg.id,
        entityType:      'package',
        metadata:        { packageId: pkg.id, unitId: pkg.unitId, trackingCode: pkg.trackingCode },
      });
    }
  }

  /**
   * Marca el paquete como NOTIFIED (residente avisado — push/SMS externo).
   */
  async markAsNotified(
    packageId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Package> {
    const pkg = await this.findByIdOrFail(packageId);
    await this.complexService.findById(pkg.complexId, currentUser);

    if (pkg.status !== PackageStatus.RECEIVED) {
      throw new CustomError({
        message: `No se puede notificar un paquete en estado ${pkg.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    pkg.status     = PackageStatus.NOTIFIED;
    pkg.notifiedAt = new Date();

    const notified = await this.packageRepo.save(pkg);
    await this.cacheService.deleteByPrefix(BK.pkg.prefix(notified.complexId));
    this.socketService.emitToComplex(notified.complexId, SocketEvent.PACKAGE_READY, {
      packageId: notified.id,
      unitId: notified.unitId,
    });
    return notified;
  }

  /**
   * Confirma la entrega del paquete al residente (o representante).
   * Requiere permiso CONFIRM_PACKAGE_DELIVERY.
   */
  async confirmDelivery(
    input: ConfirmDeliveryInput,
    currentUser: JwtAccessPayload,
  ): Promise<Package> {
    const { packageId, receivedByName, receivedByIdentity, notes } = input;
    const pkg = await this.findByIdOrFail(packageId);
    await this.complexService.findById(pkg.complexId, currentUser);

    const allowedStatuses = [PackageStatus.RECEIVED, PackageStatus.NOTIFIED, PackageStatus.READY_FOR_PICKUP];
    if (!allowedStatuses.includes(pkg.status)) {
      throw new CustomError({
        message: `No se puede entregar un paquete en estado ${pkg.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    pkg.status              = PackageStatus.DELIVERED;
    pkg.deliveredAt         = new Date();
    pkg.deliveredByUserId   = currentUser.entityType === 'user' ? currentUser.sub : undefined;
    if (receivedByName)     pkg.receivedByName     = receivedByName;
    if (receivedByIdentity) pkg.receivedByIdentity = receivedByIdentity;
    if (notes)              pkg.notes              = notes;

    const delivered = await this.packageRepo.save(pkg);
    await this.cacheService.deleteByPrefix(BK.pkg.prefix(delivered.complexId));
    this.socketService.emitToComplex(delivered.complexId, SocketEvent.PACKAGE_DELIVERED, {
      packageId: delivered.id,
      unitId: delivered.unitId,
      deliveredAt: delivered.deliveredAt,
    });
    return delivered;
  }

  /**
   * Registra la devolución del paquete al remitente.
   */
  async returnPackage(
    packageId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Package> {
    const pkg = await this.findByIdOrFail(packageId);
    await this.complexService.findById(pkg.complexId, currentUser);

    const allowedStatuses = [PackageStatus.RECEIVED, PackageStatus.NOTIFIED, PackageStatus.READY_FOR_PICKUP];
    if (!allowedStatuses.includes(pkg.status)) {
      throw new CustomError({
        message: `No se puede devolver un paquete en estado ${pkg.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    pkg.status       = PackageStatus.RETURNED;
    pkg.returnedAt   = new Date();
    pkg.returnReason = reason;

    const returned = await this.packageRepo.save(pkg);
    await this.cacheService.deleteByPrefix(BK.pkg.prefix(returned.complexId));
    return returned;
  }

  /**
   * Marca el paquete como perdido (LOST).
   */
  async markAsLost(
    packageId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Package> {
    const pkg = await this.findByIdOrFail(packageId);
    await this.complexService.findById(pkg.complexId, currentUser);

    if (pkg.status === PackageStatus.DELIVERED || pkg.status === PackageStatus.LOST) {
      throw new CustomError({
        message: `No se puede marcar como perdido un paquete en estado ${pkg.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    pkg.status       = PackageStatus.LOST;
    pkg.returnReason = reason; // reutilizamos el campo para el motivo
    pkg.returnedAt   = new Date();

    const lost = await this.packageRepo.save(pkg);
    await this.cacheService.deleteByPrefix(BK.pkg.prefix(lost.complexId));
    return lost;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Lista paquetes del complejo con filtros y paginación.
   * Guarda accedidos por: COMPLEX_ROL, SUPERVISOR_ROL, SECURITY_ROL, ACCOUNTANT_ROL.
   */
  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterPackagesInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedPackagesResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const cacheKey = BK.pkg.list(complexId, page, limit, filterKey(filters ?? {}));
    const cached = await this.cacheService.get<PaginatedPackagesResponse>({ key: cacheKey });
    if (cached) return cached;

    const qb = this.packageRepo
      .createQueryBuilder('pkg')
      .where('pkg.complexId = :complexId', { complexId })
      .andWhere('pkg.deletedAt IS NULL');

    if (filters.status)       qb.andWhere('pkg.status = :status',   { status: filters.status });
    if (filters.type)         qb.andWhere('pkg.type = :type',        { type: filters.type });
    if (filters.unitId)       qb.andWhere('pkg.unitId = :unitId',    { unitId: filters.unitId });
    if (filters.trackingCode) qb.andWhere('pkg.trackingCode ILIKE :tc', { tc: `%${filters.trackingCode}%` });
    if (filters.receivedFrom) qb.andWhere('pkg.receivedAt >= :from', { from: new Date(filters.receivedFrom) });
    if (filters.receivedUntil) qb.andWhere('pkg.receivedAt <= :until', { until: new Date(filters.receivedUntil) });

    qb.leftJoinAndSelect('pkg.unit',    'unit')
      .leftJoinAndSelect('pkg.complex', 'complex')
      .orderBy('pkg.receivedAt', 'DESC');

    const totalItems = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const totalPages = Math.ceil(totalItems / limit);

    const result: PaginatedPackagesResponse = {
      items,
      pagination: {
        currentPage:    page,
        itemsPerPage:   limit,
        totalItems,
        totalPages,
        hasNextPage:     page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
    await this.cacheService.set({ key: cacheKey, data: result, options: { ttl: BK.pkg.TTL } });
    return result;
  }

  /**
   * Paquetes pendientes (RECEIVED | NOTIFIED | READY_FOR_PICKUP) de una unidad.
   * Útil para el residente que quiere ver qué tiene en portería.
   */
  async findPendingByUnit(
    unitId: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Package[]> {
    await this.complexService.findById(complexId, currentUser);

    const cacheKey = BK.pkg.pending(complexId, unitId);
    const cached = await this.cacheService.get<Package[]>({ key: cacheKey });
    if (cached) return cached;

    const pending = await this.packageRepo.find({
      where: [
        { unitId, complexId, status: PackageStatus.RECEIVED },
        { unitId, complexId, status: PackageStatus.NOTIFIED },
        { unitId, complexId, status: PackageStatus.READY_FOR_PICKUP },
      ],
      relations: ['unit', 'complex'],
      order: { receivedAt: 'ASC' },
    });

    await this.cacheService.set({ key: cacheKey, data: pending, options: { ttl: BK.pkg.TTL } });
    return pending;
  }

  /**
   * Detalle de un paquete por ID.
   */
  async findById(
    packageId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Package> {
    const pkg = await this.findByIdOrFail(packageId);
    await this.complexService.findById(pkg.complexId, currentUser);
    return pkg;
  }

  /**
   * Actualiza la URL de la foto del paquete (llamado desde el controller REST tras subir a R2).
   */
  async updatePhotoUrl(packageId: string, photoUrl: string): Promise<Package> {
    await this.packageRepo.update(packageId, { photoUrl });
    return this.findByIdOrFail(packageId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ─────────────────────────────────────────────────────────────────────────────

  private async findByIdOrFail(packageId: string): Promise<Package> {
    const pkg = await this.packageRepo.findOne({
      where: { id: packageId, deletedAt: null as any },
      relations: ['unit', 'complex'],
    });
    if (!pkg) {
      throw new CustomError({
        message: 'Paquete no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: LogisticsErrorCode.PARCEL_NOT_FOUND,
      });
    }
    return pkg;
  }
}
