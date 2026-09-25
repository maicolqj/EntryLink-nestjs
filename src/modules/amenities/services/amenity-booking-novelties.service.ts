import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { AmenityBooking } from '../entities/amenity-booking.entity';
import { AmenityBookingNovelty } from '../entities/amenity-booking-novelty.entity';
import { AmenityBookingStatus } from '../enums/amenity-booking-status.enum';
import { User } from '../../users/entities/user.entity';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';

import { CustomError } from '../../shared/utils/errors.utils';
import { AmenityErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * En qué estados se admite una novedad: mientras la zona está en uso y después
 * de entregada. Antes del ingreso no hay nada que recibir, y una reserva
 * cancelada o vencida nunca se usó.
 */
const NOVELTY_STATUSES: AmenityBookingStatus[] = [
  AmenityBookingStatus.CHECKED_IN,
  AmenityBookingStatus.COMPLETED,
];

export interface CreateNoveltyData {
  bookingId: string;
  description: string;
  hasDamage: boolean;
  photoUrls: string[];
  photoHashes: string[];
}

/**
 * Novedades de portería sobre una reserva de zona común.
 *
 * Portería deja constancia de cómo recibe la zona; la administración decide
 * después si cobra daños con `chargeAmenityDamage`. Separar las dos cosas es
 * deliberado: el guarda ve el daño, pero cobrarlo a una unidad es una decisión
 * de la administración.
 */
@Injectable()
export class AmenityBookingNoveltiesService {
  private readonly logger = new Logger(AmenityBookingNoveltiesService.name);

  constructor(
    @InjectRepository(AmenityBookingNovelty)
    private readonly noveltyRepo: Repository<AmenityBookingNovelty>,
    @InjectRepository(AmenityBooking)
    private readonly bookingRepo: Repository<AmenityBooking>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly complexService: ResidentialComplexService,
    private readonly notificationsService: NotificationsService,
    private readonly socketService: SocketService,
  ) {}

  /**
   * Reserva a la que se le quiere registrar la novedad, validando el acceso al
   * complejo y el estado. El controlador la pide ANTES de subir las fotos: no
   * tiene sentido llenar R2 con evidencia de una reserva que no la admite.
   */
  async findBookingForNovelty(
    bookingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, deletedAt: IsNull() },
      relations: ['amenity', 'unit'],
    });

    if (!booking) {
      throw new CustomError({
        message: 'La reserva no existe o fue eliminada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.BOOKING_NOT_FOUND,
      });
    }

    await this.complexService.findById(booking.complexId, currentUser);

    if (!NOVELTY_STATUSES.includes(booking.status)) {
      throw new CustomError({
        message: 'Las novedades se registran con la zona en uso o ya entregada',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_INVALID_STATUS,
      });
    }

    return booking;
  }

  async create(
    data: CreateNoveltyData,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBookingNovelty> {
    const booking = await this.findBookingForNovelty(
      data.bookingId,
      currentUser,
    );

    const description = data.description.trim();
    if (description.length < 5) {
      throw new CustomError({
        message: 'Describe la novedad con un poco más de detalle',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_NOVELTY_INVALID,
      });
    }
    if (data.hasDamage && data.photoUrls.length === 0) {
      throw new CustomError({
        message:
          'Un daño se reporta con al menos una foto: es la evidencia para cobrarlo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_NOVELTY_INVALID,
      });
    }

    const saved = await this.noveltyRepo.save(
      this.noveltyRepo.create({
        bookingId: booking.id,
        complexId: booking.complexId,
        description,
        hasDamage: data.hasDamage,
        photoUrls: data.photoUrls,
        photoHashes: data.photoHashes,
        reportedByUserId: currentUser.sub,
        reportedByName: await this.reporterName(currentUser),
        reportedByRole: currentUser.roles?.[0] ?? null,
      }),
    );

    this.notifyAdministration(booking, saved).catch((err: unknown) =>
      this.logger.warn(
        `No se pudo avisar la novedad ${saved.id}: ${err instanceof Error ? err.message : 'error desconocido'}`,
      ),
    );

    this.socketService.emitToComplex(
      booking.complexId,
      SocketEvent.AMENITY_BOOKING_UPDATED,
      { bookingId: booking.id, status: booking.status, noveltyId: saved.id },
    );

    return saved;
  }

  async findByBooking(
    bookingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBookingNovelty[]> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, deletedAt: IsNull() },
      select: ['id', 'complexId'],
    });
    if (!booking) {
      throw new CustomError({
        message: 'La reserva no existe o fue eliminada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.BOOKING_NOT_FOUND,
      });
    }
    await this.complexService.findById(booking.complexId, currentUser);

    return this.noveltyRepo.find({
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
  }

  private async reporterName(
    currentUser: JwtAccessPayload,
  ): Promise<string | null> {
    if (currentUser.entityType !== 'user') return 'Administración';

    const user = await this.userRepo.findOne({
      where: { id: currentUser.sub },
      select: ['id', 'name', 'lastName'],
    });
    const name = user ? `${user.name ?? ''} ${user.lastName ?? ''}`.trim() : '';
    return name || currentUser.email || null;
  }

  /**
   * Avisa a la administración. Si hay daño, con prioridad alta: el plazo para
   * cobrar corre y la zona puede tener otra reserva encima.
   */
  private async notifyAdministration(
    booking: AmenityBooking,
    novelty: AmenityBookingNovelty,
  ): Promise<void> {
    const userIds = await this.notificationsService.findUserIdsByRoles(
      booking.complexId,
      [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    );
    if (userIds.length === 0) return;

    const amenityName = booking.amenity?.name ?? 'la zona común';
    const unit = booking.unit?.number ? ` (unidad ${booking.unit.number})` : '';

    await this.notificationsService.notify({
      complexId: booking.complexId,
      userIds,
      type: NotificationType.AMENITY_BOOKING_NOVELTY,
      priority: novelty.hasDamage
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL,
      title: novelty.hasDamage
        ? `⚠️ Daño reportado en ${amenityName}`
        : `Novedad en ${amenityName}`,
      body: `${novelty.reportedByName ?? 'Portería'}${unit}: ${novelty.description}`,
      entityId: booking.id,
      entityType: 'amenityBooking',
      isActionable: novelty.hasDamage,
      metadata: {
        bookingId: booking.id,
        noveltyId: novelty.id,
        amenityId: booking.amenityId,
        amenityName,
        unitId: booking.unitId,
        hasDamage: novelty.hasDamage,
        photos: novelty.photoUrls.length,
      },
    });
  }
}
