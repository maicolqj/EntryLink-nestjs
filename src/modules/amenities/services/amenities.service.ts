import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Between, ILike, IsNull, Repository } from 'typeorm';

import { Amenity } from '../entities/amenity.entity';
import { AmenitySchedule } from '../entities/amenity-schedule.entity';
import { AmenityBlackout } from '../entities/amenity-blackout.entity';
import { AmenityScheduleException } from '../entities/amenity-schedule-exception.entity';

import { AmenityStatus } from '../enums/amenity-status.enum';
import { AmenityBookingMode } from '../enums/amenity-booking-mode.enum';
import {
  AmenityDurationUnit,
  DURATION_BOUNDS_MINUTES,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
} from '../enums/amenity-duration-unit.enum';

import { CreateAmenityInput } from '../dto/inputs/create-amenity.input';
import { UpdateAmenityInput } from '../dto/inputs/update-amenity.input';
import { FilterAmenitiesInput } from '../dto/inputs/filter-amenities.input';
import {
  SetAmenitySchedulesInput,
  AmenityScheduleInput,
} from '../dto/inputs/amenity-schedule.input';
import { CreateAmenityBlackoutInput } from '../dto/inputs/create-amenity-blackout.input';
import { UpsertScheduleExceptionInput } from '../dto/inputs/upsert-schedule-exception.input';
import { PaginatedAmenitiesResponse } from '../dto/responses/paginated-amenities.response';
import { AmenityAvailabilityResponse } from '../dto/responses/amenity-availability.response';
import { AmenityAvailabilityInput } from '../dto/inputs/amenity-availability.input';

import { AmenityAvailabilityService } from './amenity-availability.service';
import { AmenityBookingsService } from './amenity-bookings.service';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { AmenityErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import {
  BK,
  filterKey,
} from '../../../core/infrastructure/cache/business-cache.constants';

@Injectable()
export class AmenitiesService {
  private readonly logger = new Logger(AmenitiesService.name);

  constructor(
    @InjectRepository(Amenity)
    private readonly amenityRepo: Repository<Amenity>,
    @InjectRepository(AmenitySchedule)
    private readonly scheduleRepo: Repository<AmenitySchedule>,
    @InjectRepository(AmenityBlackout)
    private readonly blackoutRepo: Repository<AmenityBlackout>,
    @InjectRepository(AmenityScheduleException)
    private readonly exceptionRepo: Repository<AmenityScheduleException>,
    private readonly dataSource: DataSource,
    private readonly complexService: ResidentialComplexService,
    private readonly availabilityService: AmenityAvailabilityService,
    // Crear un bloqueo cancela las reservas que caen dentro, y cancelar una
    // reserva vuelve a tocar la zona: la dependencia es mutua por diseño.
    @Inject(forwardRef(() => AmenityBookingsService))
    private readonly bookingsService: AmenityBookingsService,
    private readonly auditService: AuditService,
    private readonly cacheService: CacheService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONAS COMUNES — CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async create(
    input: CreateAmenityInput,
    currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    const { complexId, schedules, ...rest } = input;

    await this.complexService.findById(complexId, currentUser);
    this.assertCoherentBookingRules(
      input.bookingMode,
      input.durationUnit,
      input.slotDurationMinutes,
      input.minDurationMinutes,
      input.maxDurationMinutes,
    );
    await this.assertNameAvailable(complexId, rest.name);

    const amenity = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(Amenity, {
          ...rest,
          complexId,
          imageUrls: rest.imageUrls ?? [],
          createdByUserId:
            currentUser.entityType === 'user' ? currentUser.sub : null,
        }),
      );

      if (schedules?.length) {
        this.assertSchedulesCoherent(schedules);
        await manager.save(
          schedules.map((s) =>
            manager.create(AmenitySchedule, {
              amenityId: saved.id,
              complexId,
              dayOfWeek: s.dayOfWeek,
              openTime: s.openTime,
              closeTime: s.closeTime,
              isActive: true,
            }),
          ),
        );
      }

      return saved;
    });

    await this.invalidate(complexId);

    void this.auditService.log({
      entityType: AuditEntityType.Amenity,
      entityId: amenity.id,
      action: AuditAction.CREATE,
      newValue: { name: amenity.name, type: amenity.type, complexId },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId,
      description: `Zona común creada: ${amenity.name}`,
    });

    return this.findByIdOrFail(amenity.id);
  }

  async update(
    input: UpdateAmenityInput,
    currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    const { id, ...changes } = input;

    const amenity = await this.findByIdOrFail(id);
    await this.complexService.findById(amenity.complexId, currentUser);

    if (changes.name && changes.name !== amenity.name) {
      await this.assertNameAvailable(amenity.complexId, changes.name, id);
    }

    this.assertCoherentBookingRules(
      changes.bookingMode ?? amenity.bookingMode,
      changes.durationUnit ?? amenity.durationUnit,
      changes.slotDurationMinutes ?? amenity.slotDurationMinutes,
      changes.minDurationMinutes ?? amenity.minDurationMinutes,
      changes.maxDurationMinutes ?? amenity.maxDurationMinutes,
    );

    const previous = {
      name: amenity.name,
      status: amenity.status,
      feeType: amenity.feeType,
      feeAmount: amenity.feeAmount,
    };

    Object.assign(amenity, changes);
    amenity.updatedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.amenityRepo.save(amenity);
    await this.invalidate(saved.complexId);

    void this.auditService.log({
      entityType: AuditEntityType.Amenity,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: previous,
      newValue: {
        name: saved.name,
        status: saved.status,
        feeType: saved.feeType,
        feeAmount: saved.feeAmount,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Zona común actualizada: ${saved.name}`,
    });

    return this.findByIdOrFail(saved.id);
  }

  /**
   * Elimina (soft) la zona. Se niega mientras existan reservas activas a
   * futuro: borrarla dejaría a esos residentes con una reserva que apunta a
   * una zona que ya no existe.
   */
  async remove(
    amenityId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const amenity = await this.findByIdOrFail(amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    const upcoming = await this.bookingsService.countUpcomingActive(amenityId);
    if (upcoming > 0) {
      throw new CustomError({
        message: `La zona tiene ${upcoming} reserva(s) activa(s) a futuro. Cancélalas o inactiva la zona antes de eliminarla.`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_SLOT_UNAVAILABLE,
      });
    }

    await this.amenityRepo.softDelete(amenityId);
    await this.invalidate(amenity.complexId);

    void this.auditService.log({
      entityType: AuditEntityType.Amenity,
      entityId: amenityId,
      action: AuditAction.DELETE,
      previousValue: { name: amenity.name, type: amenity.type },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: amenity.complexId,
      description: `Zona común eliminada: ${amenity.name}`,
    });

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONAS COMUNES — CONSULTAS
  // ═══════════════════════════════════════════════════════════════════════════

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterAmenitiesInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedAmenitiesResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const cacheKey = BK.amenity.list(
      complexId,
      filterKey({ ...filters, page, limit }),
    );

    const cached = await this.cacheService.get<PaginatedAmenitiesResponse>({
      key: cacheKey,
    });
    if (cached) return cached;

    const where: Record<string, unknown> = { complexId, deletedAt: IsNull() };
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;
    if (filters?.search) where.name = ILike(`%${filters.search}%`);

    const [items, totalItems] = await this.amenityRepo.findAndCount({
      where,
      relations: ['schedules'],
      order: { name: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPages = Math.ceil(totalItems / limit);
    const response: PaginatedAmenitiesResponse = {
      items,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };

    await this.cacheService.set({
      key: cacheKey,
      data: response,
      options: { ttl: BK.amenity.TTL_LIST },
    });
    return response;
  }

  async findById(
    amenityId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    const amenity = await this.findByIdOrFail(amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);
    return amenity;
  }

  /** Carga sin validar acceso. Uso interno del módulo. */
  async findByIdOrFail(amenityId: string): Promise<Amenity> {
    const amenity = await this.amenityRepo.findOne({
      where: { id: amenityId, deletedAt: IsNull() },
      relations: ['schedules'],
    });

    if (!amenity) {
      throw new CustomError({
        message: 'Zona común no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.AMENITY_NOT_FOUND,
      });
    }

    return amenity;
  }

  async getAvailability(
    input: AmenityAvailabilityInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityAvailabilityResponse> {
    const amenity = await this.findByIdOrFail(input.amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    const cacheKey = BK.amenity.availability(
      amenity.complexId,
      amenity.id,
      input.from,
      input.to,
    );
    const cached = await this.cacheService.get<AmenityAvailabilityResponse>({
      key: cacheKey,
    });
    if (cached) return cached;

    const availability = await this.availabilityService.getAvailability(
      amenity,
      input.from,
      input.to,
    );

    await this.cacheService.set({
      key: cacheKey,
      data: availability,
      options: { ttl: BK.amenity.TTL_AVAIL },
    });
    return availability;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HORARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Reemplaza el horario semanal completo. Es un set y no un patch: el
   * administrador edita la parrilla entera en la web y la envía tal cual.
   */
  async setSchedules(
    input: SetAmenitySchedulesInput,
    currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    const amenity = await this.findByIdOrFail(input.amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    this.assertSchedulesCoherent(input.schedules);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(AmenitySchedule, { amenityId: amenity.id });

      if (input.schedules.length > 0) {
        await manager.save(
          input.schedules.map((s) =>
            manager.create(AmenitySchedule, {
              amenityId: amenity.id,
              complexId: amenity.complexId,
              dayOfWeek: s.dayOfWeek,
              openTime: s.openTime,
              closeTime: s.closeTime,
              isActive: true,
            }),
          ),
        );
      }
    });

    await this.invalidate(amenity.complexId);

    void this.auditService.log({
      entityType: AuditEntityType.Amenity,
      entityId: amenity.id,
      action: AuditAction.UPDATE,
      newValue: { schedules: input.schedules },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: amenity.complexId,
      description: `Horario actualizado en zona común: ${amenity.name}`,
    });

    return this.findByIdOrFail(amenity.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXCEPCIONES DE HORARIO POR FECHA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Crea o reemplaza el horario especial de una fecha.
   *
   * Es un upsert por (zona, fecha) porque el calendario del admin edita un día,
   * no acumula reglas: dos excepciones para el mismo día serían ambiguas.
   */
  async upsertScheduleException(
    input: UpsertScheduleExceptionInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityScheduleException> {
    const amenity = await this.findByIdOrFail(input.amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    // O cierra, o define una ventana completa. Media ventana no significa nada
    // y la restricción de la tabla la rechazaría con un error ilegible.
    if (!input.isClosed && (!input.openTime || !input.closeTime)) {
      throw new CustomError({
        message:
          'Indica la hora de apertura y de cierre, o marca el día como cerrado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.AMENITY_SCHEDULE_INVALID_RANGE,
      });
    }

    const existing = await this.exceptionRepo.findOne({
      where: { amenityId: amenity.id, date: input.date },
    });

    const saved = await this.exceptionRepo.save(
      this.exceptionRepo.create({
        ...(existing ? { id: existing.id } : {}),
        amenityId: amenity.id,
        complexId: amenity.complexId,
        date: input.date,
        isClosed: input.isClosed,
        openTime: input.isClosed ? null : input.openTime,
        closeTime: input.isClosed ? null : input.closeTime,
        reason: input.reason ?? null,
        createdByUserId:
          currentUser.entityType === 'user' ? currentUser.sub : null,
      }),
    );

    await this.invalidate(amenity.complexId);

    void this.auditService.log({
      entityType: AuditEntityType.Amenity,
      entityId: amenity.id,
      action: AuditAction.UPDATE,
      newValue: {
        date: saved.date,
        isClosed: saved.isClosed,
        openTime: saved.openTime,
        closeTime: saved.closeTime,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: amenity.complexId,
      description: saved.isClosed
        ? `Zona ${amenity.name} cerrada el ${saved.date}`
        : `Horario especial en ${amenity.name} el ${saved.date}: ${saved.openTime} → ${saved.closeTime}`,
    });

    return saved;
  }

  /** Quita la excepción: esa fecha vuelve a regirse por el horario semanal. */
  async deleteScheduleException(
    exceptionId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const exception = await this.exceptionRepo.findOne({
      where: { id: exceptionId },
    });
    if (!exception) {
      throw new CustomError({
        message: 'El horario especial no existe o ya fue eliminado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.AMENITY_SCHEDULE_NOT_FOUND,
      });
    }

    await this.complexService.findById(exception.complexId, currentUser);
    await this.exceptionRepo.delete(exceptionId);
    await this.invalidate(exception.complexId);
    return true;
  }

  /** Excepciones de la zona en un rango de fechas, para pintar el calendario. */
  async findScheduleExceptions(
    amenityId: string,
    from: string,
    to: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityScheduleException[]> {
    const amenity = await this.findByIdOrFail(amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    return this.exceptionRepo.find({
      where: { amenityId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUEOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bloquea la zona en un rango y cancela las reservas activas que caigan
   * dentro. Un bloqueo que conviva con reservas vigentes sería una promesa que
   * el complejo ya no puede cumplir, así que la cancelación es parte del acto.
   */
  async createBlackout(
    input: CreateAmenityBlackoutInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBlackout> {
    const amenity = await this.findByIdOrFail(input.amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    if (endAt <= startAt) {
      throw new CustomError({
        message: 'El fin del bloqueo debe ser posterior al inicio',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.AMENITY_BLACKOUT_INVALID_RANGE,
      });
    }

    const blackout = await this.blackoutRepo.save(
      this.blackoutRepo.create({
        amenityId: amenity.id,
        complexId: amenity.complexId,
        startAt,
        endAt,
        reason: input.reason,
        createdByUserId:
          currentUser.entityType === 'user' ? currentUser.sub : null,
      }),
    );

    const cancelled = await this.bookingsService.cancelBookingsInRange(
      amenity,
      startAt,
      endAt,
      `Zona bloqueada por la administración: ${input.reason}`,
      currentUser,
    );

    await this.invalidate(amenity.complexId);

    this.logger.log(
      `Bloqueo creado en zona ${amenity.name} (${startAt.toISOString()} → ${endAt.toISOString()}); ` +
        `${cancelled} reserva(s) cancelada(s)`,
    );

    void this.auditService.log({
      entityType: AuditEntityType.Amenity,
      entityId: amenity.id,
      action: AuditAction.UPDATE,
      newValue: {
        blackoutId: blackout.id,
        startAt,
        endAt,
        reason: input.reason,
        cancelledBookings: cancelled,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: amenity.complexId,
      description: `Bloqueo en zona común ${amenity.name}: ${input.reason}`,
    });

    return blackout;
  }

  async removeBlackout(
    blackoutId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const blackout = await this.blackoutRepo.findOne({
      where: { id: blackoutId },
    });

    if (!blackout) {
      throw new CustomError({
        message: 'Bloqueo no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.AMENITY_BLACKOUT_NOT_FOUND,
      });
    }

    await this.complexService.findById(blackout.complexId, currentUser);
    await this.blackoutRepo.delete(blackoutId);
    await this.invalidate(blackout.complexId);

    return true;
  }

  async findBlackouts(
    amenityId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBlackout[]> {
    const amenity = await this.findByIdOrFail(amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    return this.blackoutRepo.find({
      where: { amenityId },
      order: { startAt: 'DESC' },
      take: 100,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Borra el caché de zonas y disponibilidad del complejo. */
  async invalidate(complexId: string): Promise<void> {
    await this.cacheService.deleteByPrefix(BK.amenity.prefix(complexId));
  }

  private async assertNameAvailable(
    complexId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.amenityRepo.findOne({
      where: { complexId, name: ILike(name.trim()), deletedAt: IsNull() },
    });

    if (existing && existing.id !== excludeId) {
      throw new CustomError({
        message: `Ya existe una zona común llamada "${name}" en este complejo`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.AMENITY_NAME_ALREADY_EXISTS,
      });
    }
  }

  /**
   * Coherencia de las duraciones con la unidad de la zona.
   *
   * El DTO solo puede acotar de forma amplia porque no sabe qué unidad eligió
   * el administrador; aquí sí, y por eso se valida que cada duración caiga en el
   * rango de su unidad (1–24 h, o 1–30 días) y que sea múltiplo exacto de ella.
   * Media jornada en una zona que se alquila por días no significa nada.
   */
  private assertCoherentBookingRules(
    mode: AmenityBookingMode,
    unit: AmenityDurationUnit,
    slotDuration: number,
    minDuration: number,
    maxDuration: number,
  ): void {
    if (mode === AmenityBookingMode.RANGE && minDuration > maxDuration) {
      throw new CustomError({
        message: 'La duración mínima no puede superar la duración máxima',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.AMENITY_SCHEDULE_INVALID_RANGE,
      });
    }

    const bounds = DURATION_BOUNDS_MINUTES[unit];
    const step =
      unit === AmenityDurationUnit.DAYS ? MINUTES_PER_DAY : MINUTES_PER_HOUR;
    const label = unit === AmenityDurationUnit.DAYS ? 'días' : 'horas';
    const maxIn = bounds.max / step;

    // En SLOT solo importa el bloque; en RANGE, el mínimo y el máximo.
    const toCheck: [string, number][] =
      mode === AmenityBookingMode.SLOT
        ? [['La duración del bloque', slotDuration]]
        : [
            ['La duración mínima', minDuration],
            ['La duración máxima', maxDuration],
          ];

    for (const [what, minutes] of toCheck) {
      if (minutes < bounds.min || minutes > bounds.max) {
        throw new CustomError({
          message: `${what} debe estar entre 1 y ${maxIn} ${label}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.AMENITY_SCHEDULE_INVALID_RANGE,
        });
      }
      if (minutes % step !== 0) {
        throw new CustomError({
          message: `${what} debe expresarse en ${label} completas`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.AMENITY_SCHEDULE_INVALID_RANGE,
        });
      }
    }
  }

  /**
   * Valida el horario semanal: cada franja debe abrir antes de cerrar y dos
   * franjas del mismo día no pueden solaparse. Un solape haría que el motor
   * contara dos veces la misma hora de apertura.
   */
  private assertSchedulesCoherent(schedules: AmenityScheduleInput[]): void {
    const toMinutes = (time: string): number => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };

    // Un cierre anterior o igual a la apertura significa que la franja termina
    // al día siguiente (sábado 12:00 → domingo 05:00). Para comparar, esas
    // franjas se normalizan sumando un día al cierre.
    const MINUTES_PER_DAY_LOCAL = 24 * 60;
    const normalize = (s: AmenityScheduleInput) => {
      const open = toMinutes(s.openTime);
      const rawClose = toMinutes(s.closeTime);
      return {
        day: s.dayOfWeek,
        open,
        close: rawClose > open ? rawClose : rawClose + MINUTES_PER_DAY_LOCAL,
      };
    };

    for (const schedule of schedules) {
      const { open, close } = normalize(schedule);
      if (close - open > MINUTES_PER_DAY_LOCAL) {
        throw new CustomError({
          message: `La franja del día ${schedule.dayOfWeek} dura más de 24 horas`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.AMENITY_SCHEDULE_INVALID_RANGE,
        });
      }
    }

    for (let day = 0; day <= 6; day++) {
      const ofDay = schedules
        .filter((s) => s.dayOfWeek === day)
        .map(normalize)
        .sort((a, b) => a.open - b.open);

      for (let i = 1; i < ofDay.length; i++) {
        if (ofDay[i].open < ofDay[i - 1].close) {
          throw new CustomError({
            message: `Las franjas del día ${day} se solapan`,
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: AmenityErrorCode.AMENITY_SCHEDULE_OVERLAP,
          });
        }
      }

      // Una franja nocturna no puede invadir la apertura del día siguiente:
      // sería prometer la zona a dos reservas a la vez.
      const last = ofDay[ofDay.length - 1];
      if (!last || last.close <= MINUTES_PER_DAY_LOCAL) continue;

      const nextDay = (day + 1) % 7;
      const firstNext = schedules
        .filter((s) => s.dayOfWeek === nextDay)
        .map((s) => toMinutes(s.openTime))
        .sort((a, b) => a - b)[0];

      if (
        firstNext !== undefined &&
        last.close - MINUTES_PER_DAY_LOCAL > firstNext
      ) {
        throw new CustomError({
          message: `La franja nocturna del día ${day} se cruza con la apertura del día ${nextDay}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.AMENITY_SCHEDULE_OVERLAP,
        });
      }
    }
  }

  /** Estado operativo, para que el servicio de reservas no tenga que recargar la zona. */
  assertActive(amenity: Amenity): void {
    if (amenity.status !== AmenityStatus.ACTIVE) {
      throw new CustomError({
        message:
          amenity.status === AmenityStatus.MAINTENANCE
            ? `La zona "${amenity.name}" está en mantenimiento`
            : `La zona "${amenity.name}" no está disponible`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.AMENITY_NOT_ACTIVE,
      });
    }
  }
}
