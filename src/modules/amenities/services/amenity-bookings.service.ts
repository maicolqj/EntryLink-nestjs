import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';
import { randomBytes } from 'node:crypto';

import { Amenity } from '../entities/amenity.entity';
import { AmenityBooking } from '../entities/amenity-booking.entity';

import { AmenityBookingMode } from '../enums/amenity-booking-mode.enum';
import { AmenityFeeType } from '../enums/amenity-fee-type.enum';
import {
  AmenityDurationUnit,
  DURATION_BOUNDS_MINUTES,
  MINUTES_PER_DAY,
} from '../enums/amenity-duration-unit.enum';
import {
  AmenityBookingStatus,
  ACTIVE_BOOKING_STATUSES,
  COUNCIL_QUOTA_STATUSES,
} from '../enums/amenity-booking-status.enum';

import { CreateAmenityBookingInput } from '../dto/inputs/create-amenity-booking.input';
import { CancelAmenityBookingInput } from '../dto/inputs/cancel-amenity-booking.input';
import { RejectAmenityBookingInput } from '../dto/inputs/reject-amenity-booking.input';
import { ChargeAmenityDamageInput } from '../dto/inputs/charge-amenity-damage.input';
import { UpdateAmenityBookingCleaningInput } from '../dto/inputs/update-amenity-booking-cleaning.input';
import { RegisterAmenityBookingPaymentInput } from '../dto/inputs/register-amenity-booking-payment.input';
import { RegisterAmenityBookingRefundInput } from '../dto/inputs/register-amenity-booking-refund.input';
import { IncomeCategory } from '../../finance/enums/income-category.enum';
import { FilterAmenityBookingsInput } from '../dto/inputs/filter-amenity-bookings.input';
import { PaginatedAmenityBookingsResponse } from '../dto/responses/paginated-amenity-bookings.response';
import { AmenityCouncilQuotaResponse } from '../dto/responses/council-quota.response';

import { AmenitiesService } from './amenities.service';
import { AmenityAvailabilityService } from './amenity-availability.service';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  AmenityErrorCode,
  GeneralErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { FinanceService } from '../../finance/services/finance.service';
import { AccountingService } from '../../finance/services/accounting.service';
import { PropertyAccountStatus } from '../../finance/entities/property-account-status.entity';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Minutos antes del inicio en que la portería ya puede registrar el ingreso. */
const CHECK_IN_GRACE_MINUTES = 30;

/** Cuántas horas antes del inicio se envía el recordatorio. */
const REMINDER_LEAD_HOURS = 24;

/** Roles que administran las reservas del complejo (no las suyas). */
const STAFF_ROLES: ValidRoles[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  // ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
  // ValidRoles.ACCOUNTANT_ROL,
];

@Injectable()
export class AmenityBookingsService {
  private readonly logger = new Logger(AmenityBookingsService.name);

  constructor(
    @InjectRepository(AmenityBooking)
    private readonly bookingRepo: Repository<AmenityBooking>,
    @InjectRepository(PropertyAccountStatus)
    private readonly accountStatusRepo: Repository<PropertyAccountStatus>,
    @Inject(forwardRef(() => AmenitiesService))
    private readonly amenitiesService: AmenitiesService,
    private readonly availabilityService: AmenityAvailabilityService,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly financeService: FinanceService,
    private readonly accountingService: AccountingService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly socketService: SocketService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CREAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Crea una reserva. El residente reserva para su propia unidad; el staff
   * puede reservar a nombre de otra pasando `unitId`.
   *
   * Cuando la zona no exige aprobación la reserva nace APPROVED, lo que dispara
   * de una vez el código de acceso y el cobro. Es el mismo camino que recorre
   * `approve`, así que ambos comparten `activate`.
   */
  async create(
    input: CreateAmenityBookingInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const amenity = await this.amenitiesService.findByIdOrFail(input.amenityId);
    const complex = await this.complexService.findById(
      amenity.complexId,
      currentUser,
    );
    this.amenitiesService.assertActive(amenity);

    // El asiento contable exige un usuario real. Cuando quien opera es la cuenta
    // del complejo (entityType 'complex'), su `sub` es el id del complejo, no el
    // de un usuario, así que se atribuye al propietario — mismo criterio que
    // usa el parqueadero de visitantes.
    const actingUserId = this.resolveActingUserId(currentUser, complex.ownerId);

    const { unitId, residentId, requestedByName, isCouncilMember } =
      await this.resolveRequester(amenity.complexId, input.unitId, currentUser);

    const { startAt, endAt } = this.normalizeRange(
      amenity,
      input.startAt,
      input.endAt,
    );

    // El aseo nace con la franja sugerida por la zona. La definitiva la fija el
    // administrador: una reunión de dos horas y una fiesta de veinticuatro no
    // dejan la zona igual, y eso no se puede adivinar desde la configuración.
    const cleaningMinutes = Math.max(0, amenity.defaultCleaningMinutes ?? 0);
    const cleaningByComplex = this.resolveCleaningByComplex(
      amenity,
      input.cleaningByComplex,
    );
    const blockedUntilAt = this.addMinutes(endAt, cleaningMinutes);

    await this.assertBookable(
      amenity,
      unitId,
      startAt,
      endAt,
      blockedUntilAt,
      input.attendees,
    );

    // El cupo se decide aquí y queda congelado en la reserva: apagar el
    // beneficio en la zona después no puede cobrarle al residente algo que ya
    // se le prometió gratis.
    // `useCouncilFreeQuota` llega en true por defecto: quien no conozca el
    // beneficio no tiene que pedirlo. Ponerlo en false es la forma de guardarse
    // el cupo del año y pagar esta reserva.
    const usesCouncilQuota =
      input.useCouncilFreeQuota !== false &&
      (await this.hasCouncilQuotaLeft(
        amenity,
        residentId,
        isCouncilMember,
        startAt,
      ));

    const feeAmount = usesCouncilQuota
      ? 0
      : this.calculateFee(amenity, startAt, endAt);

    const autoApproved = !amenity.requiresApproval;

    let booking = await this.bookingRepo.save(
      this.bookingRepo.create({
        amenityId: amenity.id,
        complexId: amenity.complexId,
        unitId,
        residentId,
        requestedByUserId:
          currentUser.entityType === 'user' ? currentUser.sub : null,
        requestedByName,
        startAt,
        endAt,
        attendees: input.attendees,
        purpose: input.purpose ?? null,
        notes: input.notes ?? null,
        status: autoApproved
          ? AmenityBookingStatus.APPROVED
          : AmenityBookingStatus.PENDING,
        feeAmount,
        isCouncilFreeBooking: usesCouncilQuota,
        cleaningMinutes,
        blockedUntilAt,
        cleaningByComplex,
        // El precio del aseo se congela igual que la tarifa: subirlo después no
        // puede recobrarle a quien ya reservó.
        cleaningFeeAmount: this.cleaningPriceFor(
          amenity,
          cleaningByComplex,
          usesCouncilQuota,
        ),
      }),
    );

    if (autoApproved) {
      booking = await this.activate(booking, amenity, actingUserId);
    }

    await this.amenitiesService.invalidate(amenity.complexId);

    this.socketService.emitToComplex(
      amenity.complexId,
      SocketEvent.AMENITY_BOOKING_REQUESTED,
      {
        bookingId: booking.id,
        amenityId: amenity.id,
        amenityName: amenity.name,
        unitId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        status: booking.status,
      },
    );

    if (autoApproved) {
      this.notifyResidents(
        booking,
        amenity,
        NotificationType.AMENITY_BOOKING_APPROVED,
        '✅ Reserva confirmada',
        `Tu reserva de ${amenity.name} para el ${this.formatWhen(booking.startAt, booking.endAt)} quedó confirmada.` +
          this.accessCodeNote(booking),
      ).catch((err) =>
        this.logger.warn(
          `Error al notificar reserva ${booking.id}: ${err?.message}`,
        ),
      );
    } else {
      this.notifyStaff(
        booking,
        amenity,
        NotificationType.AMENITY_BOOKING_REQUESTED,
        '🗓️ Nueva reserva por aprobar',
        `${requestedByName ?? 'Un residente'} solicitó ${amenity.name} para el ${this.formatWhen(booking.startAt, booking.endAt)}.`,
      ).catch((err) =>
        this.logger.warn(
          `Error al notificar reserva ${booking.id}: ${err?.message}`,
        ),
      );
    }

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: booking.id,
      action: AuditAction.CREATE,
      newValue: {
        amenityId: amenity.id,
        amenityName: amenity.name,
        unitId,
        startAt,
        endAt,
        status: booking.status,
        feeAmount,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: amenity.complexId,
      description: `Reserva de ${amenity.name} — ${this.formatWhen(startAt, endAt)}`,
    });

    return booking;
  }

  /**
   * Ajusta el rango pedido a la unidad de la zona.
   *
   * En jornadas, la hora que mande el cliente es ruido: la reserva ocupa días
   * calendario completos. Se recorta al inicio del día pedido y al inicio del
   * día siguiente al último, de modo que el intervalo siga siendo semiabierto y
   * dos alquileres consecutivos no se pisen.
   */
  private normalizeRange(
    amenity: Amenity,
    rawStart: string,
    rawEnd: string,
  ): { startAt: Date; endAt: Date } {
    const startAt = new Date(rawStart);
    const endAt = new Date(rawEnd);

    if (amenity.durationUnit !== AmenityDurationUnit.DAYS)
      return { startAt, endAt };
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()))
      return { startAt, endAt };

    const spanStart = this.availabilityService.startOfDay(startAt);
    let spanEnd = this.availabilityService.startOfDay(endAt);

    // Un fin que cae dentro del último día se extiende hasta cerrarlo: quien
    // pide "del 12 al 14" espera tener la zona también el 14 completo.
    if (spanEnd <= spanStart || endAt.getTime() !== spanEnd.getTime()) {
      spanEnd = this.availabilityService.addDays(spanEnd, 1);
    }

    return { startAt: spanStart, endAt: spanEnd };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APROBAR / RECHAZAR
  // ═══════════════════════════════════════════════════════════════════════════

  async approve(
    bookingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(bookingId);
    const complex = await this.complexService.findById(
      booking.complexId,
      currentUser,
    );
    const actingUserId = this.resolveActingUserId(currentUser, complex.ownerId);

    this.assertStatus(booking, [AmenityBookingStatus.PENDING]);

    const amenity = await this.amenitiesService.findByIdOrFail(
      booking.amenityId,
    );

    // El cupo se revalida en la aprobación: entre la solicitud y este momento
    // pudo aprobarse otra reserva sobre la misma franja.
    await this.assertSlotStillFree(amenity, booking);

    booking.status = AmenityBookingStatus.APPROVED;
    booking.approvedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;
    booking.approvedAt = new Date();

    const activated = await this.activate(booking, amenity, actingUserId);
    await this.amenitiesService.invalidate(booking.complexId);

    this.emitUpdated(activated, amenity);

    this.notifyResidents(
      activated,
      amenity,
      NotificationType.AMENITY_BOOKING_APPROVED,
      '✅ Reserva aprobada',
      `Tu reserva de ${amenity.name} para el ${this.formatWhen(activated.startAt, activated.endAt)} fue aprobada.` +
        this.accessCodeNote(activated),
    ).catch((err) =>
      this.logger.warn(
        `Error al notificar aprobación ${bookingId}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: bookingId,
      action: AuditAction.APPROVE,
      newValue: {
        status: activated.status,
        feeChargeId: activated.feeChargeId,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: booking.complexId,
      description: `Reserva aprobada: ${amenity.name} — ${this.formatWhen(activated.startAt, activated.endAt)}`,
    });

    return activated;
  }

  async reject(
    input: RejectAmenityBookingInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(input.bookingId);
    await this.complexService.findById(booking.complexId, currentUser);

    this.assertStatus(booking, [AmenityBookingStatus.PENDING]);

    const amenity = await this.amenitiesService.findByIdOrFail(
      booking.amenityId,
    );

    booking.status = AmenityBookingStatus.REJECTED;
    booking.rejectionReason = input.reason;
    booking.approvedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;
    booking.approvedAt = new Date();

    const saved = await this.bookingRepo.save(booking);
    await this.amenitiesService.invalidate(booking.complexId);

    this.emitUpdated(saved, amenity);

    this.notifyResidents(
      saved,
      amenity,
      NotificationType.AMENITY_BOOKING_REJECTED,
      '❌ Reserva rechazada',
      `Tu reserva de ${amenity.name} para el ${this.formatWhen(saved.startAt, saved.endAt)} fue rechazada: ${input.reason}`,
    ).catch((err) =>
      this.logger.warn(
        `Error al notificar rechazo ${input.bookingId}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: saved.id,
      action: AuditAction.REJECT,
      newValue: { status: saved.status, reason: input.reason },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Reserva rechazada: ${amenity.name} — ${input.reason}`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCELAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cancela una reserva. El residente solo puede cancelar las de su unidad.
   *
   * El plazo suma `cancellationDeadlineDays` y `cancellationDeadlineHours`.
   * Dentro del plazo la cancelación es gratuita y el cargo se anula entero.
   * Fuera del plazo la reserva se libera igual —no tiene sentido bloquear la
   * zona— pero se retiene el porcentaje de la tarifa que fije la zona, que es
   * lo que la política de cancelación busca desincentivar.
   */
  async cancel(
    input: CancelAmenityBookingInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(input.bookingId);
    const complex = await this.complexService.findById(
      booking.complexId,
      currentUser,
    );
    await this.assertCanManageBooking(booking, currentUser);

    this.assertStatus(booking, [
      AmenityBookingStatus.PENDING,
      AmenityBookingStatus.APPROVED,
    ]);

    const amenity = await this.amenitiesService.findByIdOrFail(
      booking.amenityId,
    );

    // El plazo real suma los dos campos: el reglamento de cada copropiedad se
    // escribe "2 días antes" o "48 horas antes", y sumarlos evita que se
    // contradigan cuando el administrador llena los dos.
    const deadlineHours =
      amenity.cancellationDeadlineDays * 24 + amenity.cancellationDeadlineHours;
    const hoursToStart = (booking.startAt.getTime() - Date.now()) / HOUR_MS;
    const withinDeadline = hoursToStart >= deadlineHours;

    // Fuera de plazo se retiene la parte de la tarifa que fije la zona. Una
    // reserva sin tarifa —gratuita, o la del cupo del consejo— no tiene nada
    // que retener, así que el porcentaje se aplica sobre cero y no cobra nada.
    const retained = withinDeadline
      ? 0
      : Math.round(booking.feeAmount * amenity.lateCancellationFeePercent) /
        100;

    booking.status = AmenityBookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelledByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;
    booking.cancellationReason = input.reason ?? null;

    const performedBy =
      currentUser.entityType === 'user' ? currentUser.sub : undefined;

    // Cuánto dinero recibió ya esta reserva: lo pagado en la administración, o
    // lo abonado en la cartera sobre sus cargos. De ahí sale la devolución.
    const collected = booking.directIncomeId
      ? Number(booking.directPaymentAmount)
      : await this.financeService.collectedOnCharges([
          booking.feeChargeId ?? '',
          booking.cleaningChargeId ?? '',
        ]);

    // Solo la TARIFA responde al plazo de cancelación. El cobro por daños no:
    // responde a un hecho al recibir la zona, y cancelar tarde no puede
    // convertirlo en un castigo.
    await this.settleCancellationCharge(
      booking,
      amenity,
      retained,
      this.resolveActingUserId(currentUser, complex.ownerId),
      performedBy,
      collected > 0,
    );

    // El aseo se cobra por prestarlo. Una reserva cancelada no se asea, así que
    // su cargo se anula entero sin importar el plazo: la penalización castiga
    // haber bloqueado la agenda, no un servicio que nadie alcanzó a prestar.
    await this.voidCleaningCharge(booking, amenity, performedBy);

    // La plata que ya entró queda POR devolver, menos lo retenido por cancelar
    // tarde. El egreso se emite cuando el residente la reclame, no ahora: el
    // dinero sigue en la caja del complejo hasta que alguien venga por él.
    const refunded = this.recordRefundObligation(booking, collected, retained);

    const saved = await this.bookingRepo.save(booking);
    await this.amenitiesService.invalidate(booking.complexId);

    this.emitUpdated(saved, amenity);

    const chargeNote =
      (retained > 0
        ? ` Se retiene ${this.formatMoney(retained)} por cancelar fuera del plazo de ${this.formatDeadline(deadlineHours)}.`
        : '') +
      (refunded > 0
        ? ` Se te devuelven ${this.formatMoney(refunded)}; acércate a la administración a reclamarlos.`
        : '');

    this.notifyCancellation(saved, amenity, currentUser, chargeNote).catch(
      (err) =>
        this.logger.warn(
          `Error al notificar cancelación ${saved.id}: ${err?.message}`,
        ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      newValue: {
        status: saved.status,
        reason: input.reason,
        withinDeadline,

        feeChargeId: saved.feeChargeId,
        retained,
        lateCancellationChargeId: saved.lateCancellationChargeId,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Reserva cancelada: ${amenity.name} — ${this.formatWhen(saved.startAt, saved.endAt)}`,
    });

    return saved;
  }

  /**
   * Cancela en bloque las reservas activas que caen dentro de un rango.
   * La usa el bloqueo de zona: el motivo lo pone la administración.
   */
  async cancelBookingsInRange(
    amenity: Amenity,
    startAt: Date,
    endAt: Date,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<number> {
    const affected = await this.bookingRepo.find({
      where: {
        amenityId: amenity.id,
        deletedAt: IsNull(),
        status: In(ACTIVE_BOOKING_STATUSES),
        startAt: LessThan(endAt),
        // La franja de aseo tambien cae dentro del bloqueo: si la zona se cierra
        // el martes, la reserva del lunes que se asea el martes tampoco va.
        blockedUntilAt: MoreThan(startAt),
      },
    });

    for (const booking of affected) {
      booking.status = AmenityBookingStatus.CANCELLED;
      booking.cancelledAt = new Date();
      booking.cancelledByUserId =
        currentUser.entityType === 'user' ? currentUser.sub : null;
      booking.cancellationReason = reason;

      // Cancelación por decisión del complejo: el cargo se anula y la garantía
      // vuelve siempre, sin mirar el plazo. El residente no provocó esto.
      const performedBy =
        currentUser.entityType === 'user' ? currentUser.sub : undefined;

      if (booking.feeChargeId) {
        const cancelledCharge = await this.financeService.cancelInternalCharge(
          booking.feeChargeId,
          reason,
          performedBy,
        );
        if (cancelledCharge) booking.feeChargeId = null;
      }

      // El aseo tampoco se presta: nadie usa la zona.
      await this.voidCleaningCharge(booking, amenity, performedBy);

      await this.bookingRepo.save(booking);

      this.notifyResidents(
        booking,
        amenity,
        NotificationType.AMENITY_BOOKING_CANCELLED,
        '⚠️ Reserva cancelada',
        `Tu reserva de ${amenity.name} del ${this.formatWhen(booking.startAt, booking.endAt)} fue cancelada. ${reason}`,
      ).catch((err) =>
        this.logger.warn(
          `Error al notificar cancelación masiva ${booking.id}: ${err?.message}`,
        ),
      );
    }

    return affected.length;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PORTERÍA — INGRESO Y SALIDA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra el ingreso a la zona validando el código que muestra el residente.
   * Se admite desde `CHECK_IN_GRACE_MINUTES` antes del inicio: llegar puntual no
   * puede depender de que el reloj del guarda coincida al segundo.
   */
  async checkIn(
    complexId: string,
    accessCode: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    await this.complexService.findById(complexId, currentUser);

    const booking = await this.bookingRepo.findOne({
      where: {
        complexId,
        accessCode: accessCode.trim().toUpperCase(),
        deletedAt: IsNull(),
      },
      relations: ['amenity', 'unit'],
    });

    if (!booking) {
      throw new CustomError({
        message: 'Código de reserva inválido',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.BOOKING_ACCESS_CODE_INVALID,
      });
    }

    if (booking.status === AmenityBookingStatus.CHECKED_IN) {
      throw new CustomError({
        message: 'Esta reserva ya registró ingreso',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_ALREADY_CHECKED_IN,
      });
    }

    this.assertStatus(booking, [AmenityBookingStatus.APPROVED]);

    const now = new Date();
    if (
      now.getTime() <
      booking.startAt.getTime() - CHECK_IN_GRACE_MINUTES * MINUTE_MS
    ) {
      throw new CustomError({
        message: `El ingreso se habilita ${CHECK_IN_GRACE_MINUTES} minutos antes del inicio de la reserva`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_CHECK_IN_TOO_EARLY,
      });
    }

    booking.status = AmenityBookingStatus.CHECKED_IN;
    booking.checkInAt = now;
    booking.checkedInByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.bookingRepo.save(booking);
    await this.amenitiesService.invalidate(complexId);

    this.socketService.emitToComplex(
      complexId,
      SocketEvent.AMENITY_BOOKING_CHECKED_IN,
      {
        bookingId: saved.id,
        amenityId: saved.amenityId,
        unitId: saved.unitId,
        checkInAt: saved.checkInAt,
      },
    );

    return saved;
  }

  async checkOut(
    bookingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(bookingId);
    await this.complexService.findById(booking.complexId, currentUser);

    if (booking.status !== AmenityBookingStatus.CHECKED_IN) {
      throw new CustomError({
        message: 'La reserva no tiene un ingreso registrado',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_NOT_CHECKED_IN,
      });
    }

    booking.status = AmenityBookingStatus.COMPLETED;
    booking.checkOutAt = new Date();

    // El cobro por daños NO se registra aquí: exige revisar la zona y dejar
    // constancia del estado en que se recibe. Eso va en `chargeDamage`.
    const saved = await this.bookingRepo.save(booking);
    await this.amenitiesService.invalidate(booking.complexId);

    this.socketService.emitToComplex(
      booking.complexId,
      SocketEvent.AMENITY_BOOKING_UPDATED,
      {
        bookingId: saved.id,
        status: saved.status,
        checkOutAt: saved.checkOutAt,
      },
    );

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COBRO POR DAÑOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Carga a la unidad el valor de un daño detectado al recibir la zona.
   *
   * Reemplaza al depósito: la unidad no adelanta dinero, y solo paga si hay algo
   * que reparar. El cargo entra a la cartera de la unidad igual que el
   * parqueadero de visitantes no pagado, con la descripción que escribió la
   * administración — un cargo sin explicación en el estado de cuenta es un
   * reclamo asegurado.
   *
   * Se permite una sola vez por reserva: corregir un cobro equivocado es una
   * operación de finanzas (exonerar el cargo), no de este módulo.
   */
  async chargeDamage(
    input: ChargeAmenityDamageInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(input.bookingId);
    const complex = await this.complexService.findById(
      booking.complexId,
      currentUser,
    );
    const actingUserId = this.resolveActingUserId(currentUser, complex.ownerId);

    if (booking.damageChargeId) {
      throw new CustomError({
        message: 'Esta reserva ya tiene un cobro por daños registrado',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.DAMAGE_ALREADY_CHARGED,
      });
    }

    // Cobrar antes de que el residente use la zona no tiene sentido: el daño
    // solo puede constatarse al recibirla de vuelta.
    if (
      !booking.checkInAt &&
      booking.status !== AmenityBookingStatus.COMPLETED
    ) {
      throw new CustomError({
        message:
          'El cobro por daños se registra cuando el residente entrega la zona',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.DAMAGE_NOT_CHARGEABLE_YET,
      });
    }

    const amenityName = booking.amenity?.name ?? 'zona común';
    const description = input.description.trim();

    const now = new Date();
    const { chargeId } = await this.dataSource.transaction((em) =>
      this.accountingService.emitAmenityUnitCharge(em, {
        complexId: booking.complexId,
        unitId: booking.unitId,
        amount: input.amount,
        // El daño es ingreso del mes en que se constata, no del de la reserva.
        period: this.periodOf(now),
        dueDate: new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        ),
        documentDate: now,
        description: `Daños en ${amenityName} — ${description}`,
        createdByUserId: actingUserId,
      }),
    );

    booking.damageChargeId = chargeId;
    booking.damageAmount = input.amount;
    booking.damageDescription = description;
    booking.damageChargedAt = new Date();
    booking.damageChargedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.bookingRepo.save(booking);

    this.notifyResidents(
      saved,
      saved.amenity ?? ({ id: saved.amenityId, name: amenityName } as Amenity),
      NotificationType.AMENITY_DAMAGE_CHARGED,
      '⚠️ Cobro por daños en zona común',
      `Se cargó a tu unidad un valor por daños en ${amenityName}: ${description}`,
    ).catch((err) =>
      this.logger.warn(`Error al notificar daños ${saved.id}: ${err?.message}`),
    );

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      newValue: {
        damageAmount: saved.damageAmount,
        damageDescription: saved.damageDescription,
        damageChargeId: saved.damageChargeId,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Cobro por daños en ${amenityName}: ${description}`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSULTAS
  // ═══════════════════════════════════════════════════════════════════════════

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterAmenityBookingsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedAmenityBookingsResponse> {
    await this.complexService.findById(complexId, currentUser);
    return this.queryBookings(complexId, pagination, filters);
  }

  /** Reservas de la unidad del residente autenticado. El scope se fuerza aquí. */
  async findMyUnitBookings(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterAmenityBookingsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedAmenityBookingsResponse> {
    const resident = await this.residentsService.findMyProfile(
      currentUser.sub,
      complexId,
    );
    return this.queryBookings(complexId, pagination, {
      ...filters,
      unitId: resident.unitId,
    });
  }

  async findById(
    bookingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(bookingId);
    await this.complexService.findById(booking.complexId, currentUser);
    await this.assertCanManageBooking(booking, currentUser);
    return booking;
  }

  /** Reservas activas de una zona que aún no han empezado. */
  async countUpcomingActive(amenityId: string): Promise<number> {
    return this.bookingRepo.count({
      where: {
        amenityId,
        deletedAt: IsNull(),
        status: In(ACTIVE_BOOKING_STATUSES),
        endAt: MoreThan(new Date()),
      },
    });
  }

  private async queryBookings(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterAmenityBookingsInput,
  ): Promise<PaginatedAmenityBookingsResponse> {
    const { page, limit } = pagination;

    // Las condiciones usan nombres de PROPIEDAD de la entidad, no de columna:
    // al paginar con joins TypeORM arma una subconsulta de ids y necesita
    // resolver el orderBy contra los metadatos. Con `b.start_at` no lo
    // encuentra y revienta con "cannot read properties of undefined".
    const qb = this.bookingRepo
      .createQueryBuilder('b')
      .where('b.complexId = :complexId', { complexId })
      .andWhere('b.deletedAt IS NULL');

    if (filters?.status)
      qb.andWhere('b.status = :status', { status: filters.status });
    if (filters?.amenityId)
      qb.andWhere('b.amenityId = :amenityId', { amenityId: filters.amenityId });
    if (filters?.unitId)
      qb.andWhere('b.unitId = :unitId', { unitId: filters.unitId });
    if (filters?.startFrom)
      qb.andWhere('b.startAt >= :startFrom', {
        startFrom: new Date(filters.startFrom),
      });
    if (filters?.startUntil)
      qb.andWhere('b.startAt <= :startUntil', {
        startUntil: new Date(filters.startUntil),
      });

    qb.leftJoinAndSelect('b.amenity', 'amenity')
      .leftJoinAndSelect('b.unit', 'unit')
      .orderBy('b.startAt', 'DESC');

    const totalItems = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // El pago por cartera se registra en finanzas, que no le avisa a este
    // módulo. Sin esto, la reserva ya pagada aparecería en la lista sin código
    // hasta que alguien la abriera una por una.
    await this.ensureAccessCodes(items);

    const totalPages = Math.ceil(totalItems / limit);

    return {
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
  }

  async findByIdOrFail(bookingId: string): Promise<AmenityBooking> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, deletedAt: IsNull() },
      relations: ['amenity', 'unit'],
    });

    if (!booking) {
      throw new CustomError({
        message: 'Reserva no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.BOOKING_NOT_FOUND,
      });
    }

    return this.ensureAccessCode(booking);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MANTENIMIENTO PROGRAMADO (lo invoca el cron)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Reservas que nadie aprobó y cuya hora ya pasó: quedan EXPIRED y liberan cupo. */
  async expireStalePending(): Promise<number> {
    const result = await this.bookingRepo
      .createQueryBuilder()
      .update(AmenityBooking)
      .set({ status: AmenityBookingStatus.EXPIRED })
      .where('status = :status', { status: AmenityBookingStatus.PENDING })
      .andWhere('startAt < :now', { now: new Date() })
      .andWhere('deletedAt IS NULL')
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Reservas aprobadas que terminaron sin que nadie registrara ingreso.
   * Se marcan NO_SHOW: es el dato que sostiene cualquier sanción posterior por
   * bloquear una zona y no usarla.
   */
  async markNoShows(): Promise<number> {
    const stale = await this.bookingRepo.find({
      where: {
        status: AmenityBookingStatus.APPROVED,
        endAt: LessThan(new Date()),
        deletedAt: IsNull(),
      },
      relations: ['amenity'],
      take: 500,
    });

    for (const booking of stale) {
      booking.status = AmenityBookingStatus.NO_SHOW;
      await this.bookingRepo.save(booking);

      if (booking.amenity) {
        this.notifyResidents(
          booking,
          booking.amenity,
          NotificationType.AMENITY_BOOKING_NO_SHOW,
          'Reserva no utilizada',
          `Tu reserva de ${booking.amenity.name} del ${this.formatWhen(booking.startAt, booking.endAt)} se cerró sin registro de ingreso.`,
        ).catch(() => undefined);
      }
    }

    return stale.length;
  }

  /**
   * Reservas con ingreso registrado cuya hora de fin ya pasó: se cierran solas.
   *
   * Va fila por fila y no con un UPDATE masivo porque cerrar una reserva
   * también devuelve su depósito, y eso toca finanzas por cada una.
   */
  async autoCompleteCheckedIn(): Promise<number> {
    const finished = await this.bookingRepo.find({
      where: {
        status: AmenityBookingStatus.CHECKED_IN,
        endAt: LessThan(new Date()),
        deletedAt: IsNull(),
      },
      relations: ['amenity'],
      take: 500,
    });

    for (const booking of finished) {
      booking.status = AmenityBookingStatus.COMPLETED;
      booking.checkOutAt = new Date();

      // El depósito queda PENDING a propósito: un cron no puede dar fe de que
      // la zona se entregó sin daños ni de a quién se le devolvió el efectivo.
      await this.bookingRepo.save(booking);
    }

    return finished.length;
  }

  /** Recordatorio a la unidad de las reservas que empiezan en las próximas horas. */
  async sendUpcomingReminders(): Promise<number> {
    const now = new Date();
    const horizon = new Date(now.getTime() + REMINDER_LEAD_HOURS * HOUR_MS);

    const upcoming = await this.bookingRepo.find({
      where: {
        status: AmenityBookingStatus.APPROVED,
        startAt: Between(now, horizon),
        reminderSentAt: IsNull(),
        deletedAt: IsNull(),
      },
      relations: ['amenity'],
      take: 500,
    });

    for (const booking of upcoming) {
      if (!booking.amenity) continue;

      await this.notifyResidents(
        booking,
        booking.amenity,
        NotificationType.AMENITY_REMINDER,
        '⏰ Recordatorio de reserva',
        `Tu reserva de ${booking.amenity.name} es el ${this.formatWhen(booking.startAt, booking.endAt)}.` +
          (booking.accessCode
            ? ` Código de ingreso: ${booking.accessCode}.`
            : ''),
      ).catch((err) =>
        this.logger.warn(
          `Error al enviar recordatorio ${booking.id}: ${err?.message}`,
        ),
      );

      booking.reminderSentAt = new Date();
      await this.bookingRepo.save(booking);
    }

    return upcoming.length;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGO DEL ALQUILER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra que el residente pagó el alquiler en la administración.
   *
   * Por defecto el alquiler se cobra a la CARTERA de la unidad: al aprobar se
   * emite el cargo y el ingreso queda causado. Cuando en cambio el residente
   * se acerca y paga, ese mismo dinero tiene que entrar a caja del complejo
   * —es la sección de ingresos directos, categoría "alquiler de zona social"—.
   *
   * Los dos caminos NO son acumulables. El resumen financiero calcula
   * `totalCollected + directIncome`, así que dejar el cargo colgando de la
   * unidad y además registrar el ingreso contaría el mismo alquiler dos veces
   * y le dejaría una deuda falsa a la unidad. Por eso registrar el pago ANULA
   * los cargos de la reserva —tarifa y aseo— y los reemplaza por el ingreso.
   *
   * Si el cargo ya tiene abonos, no se convierte: esa plata ya entró por
   * cartera y moverla de sitio descuadraría lo que la unidad ya pagó.
   *
   * El cobro por daños no pasa por aquí. Se constata al recibir la zona, cuando
   * el residente ya no está en la ventanilla, y siempre se carga a la unidad.
   */
  async registerDirectPayment(
    input: RegisterAmenityBookingPaymentInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(input.bookingId);
    await this.complexService.findById(booking.complexId, currentUser);

    const performedBy =
      currentUser.entityType === 'user' ? currentUser.sub : undefined;

    if (booking.directIncomeId) {
      throw new CustomError({
        message: 'Esta reserva ya tiene registrado el pago en la administración',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_ALREADY_COLLECTED,
      });
    }

    // Solo desde que la reserva está en firme. Una PENDING todavía puede
    // rechazarse, y cobrar antes dejaría un ingreso en caja por una reserva
    // que nunca existió —con la plata ya contada en el mes—.
    this.assertStatus(booking, [
      AmenityBookingStatus.APPROVED,
      AmenityBookingStatus.CHECKED_IN,
      AmenityBookingStatus.COMPLETED,
      // No asistió, pero bloqueó la zona y el alquiler se le cobra igual.
      AmenityBookingStatus.NO_SHOW,
    ]);

    const amenity = await this.amenitiesService.findByIdOrFail(
      booking.amenityId,
    );

    // Lo que la reserva vale: la tarifa más el aseo que asumió el conjunto.
    const owed =
      Number(booking.feeAmount) +
      (booking.cleaningByComplex ? Number(booking.cleaningFeeAmount) : 0);

    const amount = input.amount ?? owed;
    if (amount <= 0) {
      throw new CustomError({
        message: 'Esta reserva no tiene ningún valor que cobrar',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_NOTHING_TO_COLLECT,
      });
    }

    // ── Se liberan los cargos de la cartera ────────────────────────────────
    const reason = `Pagado en la administración — ${amenity.name}`;

    for (const key of ['feeChargeId', 'cleaningChargeId'] as const) {
      const chargeId = booking[key];
      if (!chargeId) continue;

      const cancelled = await this.financeService.cancelInternalCharge(
        chargeId,
        reason,
        performedBy,
      );

      // `cancelInternalCharge` devuelve null cuando el cargo ya tiene abonos.
      // Ese dinero entró por cartera y no se puede mudar a caja sin descuadrar
      // lo que la unidad ya pagó: se para aquí antes de tocar nada más.
      if (!cancelled) {
        throw new CustomError({
          message:
            'El cargo de esta reserva ya tiene pagos aplicados en la cartera de la unidad. Reversa ese pago antes de registrarlo como ingreso del complejo.',
          statusCode: HttpStatus.CONFLICT,
          errorCode: AmenityErrorCode.BOOKING_CHARGE_ALREADY_PAID,
        });
      }

      booking[key] = null;
    }

    // ── Entra a caja del complejo ──────────────────────────────────────────
    const incomeDate = input.incomeDate ? new Date(input.incomeDate) : new Date();
    const unitLabel = booking.unit?.number ? ` — Unidad ${booking.unit.number}` : '';

    const income = await this.financeService.registerDirectIncome(
      {
        complexId: booking.complexId,
        amount,
        description: `Alquiler ${amenity.name} — ${this.formatWhen(booking.startAt, booking.endAt)}${unitLabel}`,
        category: IncomeCategory.HALL_RENTAL,
        // El ingreso directo es de caja: pertenece al período en que se recibió
        // el dinero, no al de la reserva.
        period: this.periodOf(incomeDate),
        incomeDate,
        receiptUrl: input.receiptUrl,
        notes: input.notes,
      },
      currentUser,
    );

    booking.directIncomeId = income.id;
    booking.directPaymentAmount = amount;
    booking.directPaymentAt = new Date();
    booking.directPaymentByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    // Pagó: ya puede entrar. Este es el momento en que nace el código para las
    // reservas que se cobran.
    if (!booking.accessCode) booking.accessCode = this.generateAccessCode();

    const saved = await this.bookingRepo.save(booking);
    await this.amenitiesService.invalidate(booking.complexId);

    this.emitUpdated(saved, amenity);

    this.notifyResidents(
      saved,
      amenity,
      NotificationType.AMENITY_PAYMENT_RECEIVED,
      '💵 Recibimos el pago de tu reserva',
      `La administración registró el pago de ${this.formatMoney(amount)} por ${amenity.name} (${this.formatWhen(saved.startAt, saved.endAt)}).` +
        (saved.accessCode
          ? ` Tu código de ingreso es ${saved.accessCode}.`
          : ''),
    ).catch((err) =>
      this.logger.warn(
        `Error al notificar el pago de la reserva ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      newValue: {
        directIncomeId: saved.directIncomeId,
        directPaymentAmount: saved.directPaymentAmount,
        feeChargeId: saved.feeChargeId,
        cleaningChargeId: saved.cleaningChargeId,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Pago del alquiler recibido en la administración: ${amenity.name} — ${this.formatMoney(amount)}`,
    });

    return saved;
  }

  /**
   * Entrega la devolución que quedó pendiente al cancelar una reserva pagada.
   *
   * Es el momento en que el dinero SALE de la caja, y por eso es acá —y no al
   * cancelar— donde se emite el comprobante de egreso. Cancelar solo crea la
   * obligación: entre una cosa y la otra pueden pasar días, o el residente
   * puede no volver nunca, y contabilizar la salida antes dejaría los libros
   * diciendo que la plata ya no está mientras sigue en el cajón.
   *
   * El comprobante lleva el CÓDIGO de la reserva: es lo único que ata una
   * salida de caja a un hecho concreto cuando alguien audite el egreso meses
   * después.
   */
  async registerRefund(
    input: RegisterAmenityBookingRefundInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(input.bookingId);
    await this.complexService.findById(booking.complexId, currentUser);

    if (booking.refundAmount <= 0) {
      throw new CustomError({
        message: 'Esta reserva no tiene ninguna devolución pendiente',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.REFUND_NOTHING_TO_PAY,
      });
    }

    if (booking.refundedAt) {
      throw new CustomError({
        message: 'La devolución de esta reserva ya se entregó',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.REFUND_ALREADY_PAID,
      });
    }

    const amenity = await this.amenitiesService.findByIdOrFail(
      booking.amenityId,
    );

    const amount = input.amount ?? Number(booking.refundAmount);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

    const reference = booking.accessCode
      ? `código ${booking.accessCode}`
      : `${amenity.name} — ${this.formatWhen(booking.startAt, booking.endAt)}`;

    const memo = `Devolución por cancelación de reserva de zonas comunes — ${reference}`;

    let voucherId: string | null = null;
    try {
      const voucher = await this.accountingService.emitAmenityRefundVoucher(
        {
          complexId: booking.complexId,
          amount,
          period: this.periodOf(paidAt),
          documentDate: paidAt,
          memo: input.notes ? `${memo} · ${input.notes}` : memo,
          unitId: booking.unitId,
          thirdPartyName: booking.unit?.number
            ? `Unidad ${booking.unit.number}`
            : undefined,
        },
        currentUser,
      );
      voucherId = voucher?.id ?? null;
    } catch (err: any) {
      // Un fallo de contabilidad no puede impedir dejar constancia de que la
      // plata se entregó: el residente ya se fue con ella.
      this.logger.error(
        `No se pudo emitir el egreso de devolución de la reserva ${booking.id}: ${err?.message}`,
      );
    }

    booking.refundAmount = amount;
    booking.refundVoucherId = voucherId;
    booking.refundedAt = paidAt;

    const saved = await this.bookingRepo.save(booking);

    // El residente tiene que poder confrontar lo que recibió contra lo que el
    // complejo dice que entregó. Sin el monto, el aviso no sirve de recibo.
    this.notifyResidents(
      saved,
      amenity,
      NotificationType.AMENITY_REFUND_PAID,
      '💵 Devolución entregada',
      `La administración te entregó ${this.formatMoney(amount)} por la cancelación de tu reserva de ${amenity.name} (${this.formatWhen(saved.startAt, saved.endAt)}).`,
    ).catch((err) =>
      this.logger.warn(
        `Error al notificar la devolución de la reserva ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      newValue: {
        refundAmount: saved.refundAmount,
        refundVoucherId: saved.refundVoucherId,
        refundedAt: saved.refundedAt,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Devolución entregada: ${amenity.name} — ${this.formatMoney(amount)}`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASEO DE LA ZONA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * La administración ajusta el aseo de una reserva: cuánto tiempo bloquea la
   * zona después y quién lo hace.
   *
   * La franja es decisión suya y no de la zona porque depende de lo que se hizo
   * adentro, y eso solo se sabe reserva por reserva. Quién asea lo propone el
   * residente al reservar, pero la administración manda: si la zona se entrega
   * sucia, el servicio se factura aunque el residente hubiera dicho que él se
   * encargaba. En los dos casos el residente se entera —le llega el aviso—,
   * porque son plata y tiempo suyos.
   */
  async updateCleaning(
    input: UpdateAmenityBookingCleaningInput,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    const booking = await this.findByIdOrFail(input.bookingId);
    const complex = await this.complexService.findById(
      booking.complexId,
      currentUser,
    );
    const actingUserId = this.resolveActingUserId(currentUser, complex.ownerId);
    const performedBy =
      currentUser.entityType === 'user' ? currentUser.sub : undefined;

    // Una reserva rechazada, cancelada o ya cerrada no tiene agenda que
    // bloquear ni servicio que prestar. Para lo que se descubre después de
    // cerrarla está el cobro por daños.
    const editable: AmenityBookingStatus[] = [
      AmenityBookingStatus.PENDING,
      AmenityBookingStatus.APPROVED,
      AmenityBookingStatus.CHECKED_IN,
    ];
    if (!editable.includes(booking.status)) {
      throw new CustomError({
        message: 'El aseo solo se ajusta mientras la reserva sigue vigente',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.CLEANING_NOT_EDITABLE,
      });
    }

    const amenity = await this.amenitiesService.findByIdOrFail(
      booking.amenityId,
    );

    const before = {
      cleaningMinutes: booking.cleaningMinutes,
      cleaningByComplex: booking.cleaningByComplex,
    };

    const cleaningMinutes = Math.max(
      0,
      input.cleaningMinutes ?? booking.cleaningMinutes,
    );
    const cleaningByComplex =
      input.cleaningByComplex === undefined
        ? booking.cleaningByComplex
        : this.resolveCleaningByComplex(amenity, input.cleaningByComplex);

    if (
      cleaningMinutes === before.cleaningMinutes &&
      cleaningByComplex === before.cleaningByComplex
    ) {
      return booking;
    }

    const blockedUntilAt = this.addMinutes(booking.endAt, cleaningMinutes);

    // Alargar la franja puede pisarle la hora a la reserva siguiente, que ya
    // está prometida. Ahí manda quien llegó primero: la franja no se impone.
    if (blockedUntilAt > (booking.blockedUntilAt ?? booking.endAt)) {
      const overlapping =
        await this.availabilityService.countOverlappingBookings(
          amenity.id,
          booking.startAt,
          blockedUntilAt,
          booking.id,
        );

      if (overlapping >= amenity.maxSimultaneousBookings) {
        throw new CustomError({
          message:
            'Esa franja de aseo se cruza con la siguiente reserva de la zona',
          statusCode: HttpStatus.CONFLICT,
          errorCode: AmenityErrorCode.CLEANING_WINDOW_COLLIDES,
        });
      }
    }

    booking.cleaningMinutes = cleaningMinutes;
    booking.blockedUntilAt = blockedUntilAt;
    booking.cleaningByComplex = cleaningByComplex;
    booking.cleaningUpdatedAt = new Date();
    booking.cleaningUpdatedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    if (!cleaningByComplex) {
      // Deja de prestarse el servicio: el cargo se anula entero. Los asientos
      // del ledger son inmutables, así que rebajarlo no es una opción.
      await this.voidCleaningCharge(booking, amenity, performedBy);
      booking.cleaningFeeAmount = 0;
    } else {
      if (booking.cleaningFeeAmount <= 0) {
        booking.cleaningFeeAmount = this.cleaningPriceFor(
          amenity,
          true,
          booking.isCouncilFreeBooking,
        );
      }

      // Una reserva sin aprobar todavía no tiene cargos: los emite `activate`
      // cuando se aprueba, y este valor entra ahí.
      if (
        booking.status !== AmenityBookingStatus.PENDING &&
        booking.cleaningFeeAmount > 0 &&
        !booking.cleaningChargeId
      ) {
        booking.cleaningChargeId = await this.tryCreateCharge(
          booking,
          {
            description: `Aseo de ${amenity.name} — ${this.formatWhen(booking.startAt, booking.endAt)}`,
            amount: booking.cleaningFeeAmount,
            dueDate: this.availabilityService.endOfDay(booking.startAt),
            period: this.periodOf(booking.startAt),
          },
          actingUserId,
        );
      }
    }

    const saved = await this.bookingRepo.save(booking);
    await this.amenitiesService.invalidate(booking.complexId);

    this.emitUpdated(saved, amenity);

    this.notifyResidents(
      saved,
      amenity,
      NotificationType.AMENITY_CLEANING_UPDATED,
      '🧹 Cambió el aseo de tu reserva',
      this.describeCleaningChange(saved, amenity, before),
    ).catch((err) =>
      this.logger.warn(
        `Error al notificar el aseo de la reserva ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.AmenityBooking,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: before,
      newValue: {
        cleaningMinutes: saved.cleaningMinutes,
        cleaningByComplex: saved.cleaningByComplex,
        cleaningFeeAmount: saved.cleaningFeeAmount,
        cleaningChargeId: saved.cleaningChargeId,
        blockedUntilAt: saved.blockedUntilAt,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Aseo de la reserva: ${amenity.name} — ${this.formatWhen(saved.startAt, saved.endAt)}`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDACIÓN DE RESERVAS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Reglas que debe cumplir una reserva nueva, en orden de coste creciente:
   * primero lo que se resuelve en memoria, después las consultas.
   */
  private async assertBookable(
    amenity: Amenity,
    unitId: string,
    startAt: Date,
    endAt: Date,
    /** Fin de la ocupación: `endAt` más la franja de aseo. */
    blockedUntilAt: Date,
    attendees: number,
  ): Promise<void> {
    const now = new Date();

    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt <= startAt
    ) {
      throw new CustomError({
        message:
          'El rango de la reserva es inválido: el fin debe ser posterior al inicio',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_INVALID_RANGE,
      });
    }

    if (startAt <= now) {
      throw new CustomError({
        message: 'No se puede reservar una franja que ya pasó',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_IN_THE_PAST,
      });
    }

    const daysAhead = (startAt.getTime() - now.getTime()) / DAY_MS;
    if (daysAhead < amenity.minAdvanceDays) {
      throw new CustomError({
        message: `La reserva requiere al menos ${amenity.minAdvanceDays} día(s) de anticipación`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_TOO_SOON,
      });
    }

    if (daysAhead > amenity.advanceBookingDays) {
      throw new CustomError({
        message: `Solo se puede reservar con hasta ${amenity.advanceBookingDays} día(s) de anticipación`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_TOO_FAR_AHEAD,
      });
    }

    const isByDays = amenity.durationUnit === AmenityDurationUnit.DAYS;
    const dayStart = this.availabilityService.startOfDay(startAt);

    // Ya no se exige que empiece y termine el mismo día: un salón que se presta
    // del sábado al mediodía hasta el domingo a las 5 a. m. es un caso normal.
    // Quien acota el rango es la ventana de horario, que ahora puede cruzar la
    // medianoche, más la duración máxima de la zona.

    // En modo jornadas el rango debe caer en fronteras de día. El servicio ya
    // normalizó lo que envió el cliente, así que un desajuste aquí solo puede
    // venir de una llamada directa a la API.
    if (isByDays) {
      const endOfSpan = this.availabilityService.startOfDay(endAt);
      if (
        startAt.getTime() !== dayStart.getTime() ||
        endAt.getTime() !== endOfSpan.getTime()
      ) {
        throw new CustomError({
          message: 'Esta zona se reserva por días completos',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.BOOKING_INVALID_DAY_RANGE,
        });
      }
    }

    const durationMinutes = (endAt.getTime() - startAt.getTime()) / MINUTE_MS;
    const unitLabel = (minutes: number): string =>
      isByDays ? this.asDays(minutes) : this.asHours(minutes);

    if (amenity.bookingMode === AmenityBookingMode.SLOT) {
      if (durationMinutes !== amenity.slotDurationMinutes) {
        throw new CustomError({
          message: `Esta zona se reserva en bloques de ${unitLabel(amenity.slotDurationMinutes)}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.BOOKING_INVALID_SLOT_START,
        });
      }
    } else {
      if (durationMinutes < amenity.minDurationMinutes) {
        throw new CustomError({
          message: `La reserva debe durar al menos ${unitLabel(amenity.minDurationMinutes)}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.BOOKING_DURATION_TOO_SHORT,
        });
      }
      if (durationMinutes > amenity.maxDurationMinutes) {
        throw new CustomError({
          message: `La reserva no puede durar más de ${unitLabel(amenity.maxDurationMinutes)}`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: AmenityErrorCode.BOOKING_DURATION_TOO_LONG,
        });
      }
    }

    if (amenity.capacity > 0 && attendees > amenity.capacity) {
      throw new CustomError({
        message: `El aforo de ${amenity.name} es de ${amenity.capacity} persona(s)`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_EXCEEDS_CAPACITY,
      });
    }

    // ── Horario y bloqueos ──────────────────────────────────────────────────

    if (isByDays) {
      await this.assertSpanIsOpen(amenity, dayStart, endAt);
    } else {
      // En modo RANGE el residente arma la reserva, y esa reserva puede cruzar
      // la medianoche si la zona no cierra ahí: el salón que se entrega el
      // sábado a las 2 p. m. con 24 h de tope se devuelve el domingo a esa
      // misma hora. En modo SLOT no hace falta —la franja siempre cabe en la
      // ventana que la generó— y además el alineamiento se cuenta desde la
      // apertura de la ventana del día, que unir periodos desplazaría.
      const openWindows =
        amenity.bookingMode === AmenityBookingMode.RANGE
          ? await this.availabilityService.getContinuousWindowsForDay(
              amenity.id,
              dayStart,
            )
          : await this.availabilityService.getOpenWindowsForDay(
              amenity.id,
              dayStart,
            );

      const fitsInWindow = openWindows.some(
        (w) => startAt >= w.startAt && endAt <= w.endAt,
      );

      if (!fitsInWindow) {
        const blackout = await this.availabilityService.findBlackoutOverlapping(
          amenity.id,
          startAt,
          endAt,
        );
        throw new CustomError({
          message: blackout
            ? `La zona está bloqueada en ese horario: ${blackout.reason}`
            : `${amenity.name} no está abierta en ese horario`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: blackout
            ? AmenityErrorCode.BOOKING_ON_BLACKOUT
            : AmenityErrorCode.BOOKING_OUTSIDE_SCHEDULE,
        });
      }

      if (amenity.bookingMode === AmenityBookingMode.SLOT) {
        this.assertAlignedToSlot(amenity, openWindows, startAt);
      }
    }

    // ── Cupo de la franja ───────────────────────────────────────────────────

    // Contra la ocupación, no contra el uso: la franja de aseo de esta reserva
    // tampoco puede pisarle la hora a la siguiente.
    const overlapping = await this.availabilityService.countOverlappingBookings(
      amenity.id,
      startAt,
      blockedUntilAt,
    );
    if (overlapping >= amenity.maxSimultaneousBookings) {
      throw new CustomError({
        message: 'La franja seleccionada ya no tiene cupo disponible',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_SLOT_UNAVAILABLE,
      });
    }

    // ── Límites de la unidad ────────────────────────────────────────────────

    await this.assertUnitLimits(amenity, unitId, startAt);
    await this.assertUnitSolvent(amenity, unitId);
  }

  /**
   * Una reserva por jornadas ocupa la zona los días completos del tramo, así
   * que cada uno de esos días tiene que estar abierto y sin bloqueos. Basta con
   * que un día intermedio esté cerrado —el domingo, por ejemplo— para que el
   * tramo entero deje de ser reservable: prometer una zona que cierra en la
   * mitad del alquiler es peor que no ofrecerla.
   */
  private async assertSpanIsOpen(
    amenity: Amenity,
    spanStart: Date,
    spanEnd: Date,
  ): Promise<void> {
    const blackout = await this.availabilityService.findBlackoutOverlapping(
      amenity.id,
      spanStart,
      spanEnd,
    );
    if (blackout) {
      throw new CustomError({
        message: `La zona está bloqueada dentro de ese rango: ${blackout.reason}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_ON_BLACKOUT,
      });
    }

    for (
      let day = new Date(spanStart);
      day < spanEnd;
      day = this.availabilityService.addDays(day, 1)
    ) {
      const windows = await this.availabilityService.getOpenWindowsForDay(
        amenity.id,
        day,
      );
      if (windows.length === 0) {
        throw new CustomError({
          message: `${amenity.name} no abre el ${this.formatDay(day)}, así que no cubre todo el rango`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: AmenityErrorCode.BOOKING_SPAN_NOT_AVAILABLE,
        });
      }
    }
  }

  /**
   * En modo SLOT el inicio debe caer en una frontera de franja contada desde la
   * apertura de la ventana. Sin esto un residente podría desplazar todas las
   * franjas 15 minutos y dejar huecos inutilizables entre reservas.
   */
  private assertAlignedToSlot(
    amenity: Amenity,
    openWindows: { startAt: Date; endAt: Date }[],
    startAt: Date,
  ): void {
    const stepMs = amenity.slotDurationMinutes * MINUTE_MS;

    const aligned = openWindows.some((w) => {
      if (startAt < w.startAt || startAt >= w.endAt) return false;
      return (startAt.getTime() - w.startAt.getTime()) % stepMs === 0;
    });

    if (!aligned) {
      throw new CustomError({
        message: `El inicio debe coincidir con una franja de ${this.asHours(amenity.slotDurationMinutes)}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_INVALID_SLOT_START,
      });
    }
  }

  private async assertUnitLimits(
    amenity: Amenity,
    unitId: string,
    startAt: Date,
  ): Promise<void> {
    if (amenity.maxActiveBookingsPerUnit > 0) {
      const active = await this.bookingRepo.count({
        where: {
          amenityId: amenity.id,
          unitId,
          deletedAt: IsNull(),
          status: In(ACTIVE_BOOKING_STATUSES),
          endAt: MoreThan(new Date()),
        },
      });

      if (active >= amenity.maxActiveBookingsPerUnit) {
        throw new CustomError({
          message: `Tu unidad ya tiene ${active} reserva(s) vigente(s) en ${amenity.name}. Cancela una antes de crear otra.`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: AmenityErrorCode.BOOKING_UNIT_LIMIT_REACHED,
        });
      }
    }

    if (amenity.maxBookingsPerUnitPerMonth > 0) {
      const monthStart = new Date(startAt.getFullYear(), startAt.getMonth(), 1);
      const monthEnd = new Date(
        startAt.getFullYear(),
        startAt.getMonth() + 1,
        1,
      );

      // Cuentan también las ya usadas: el límite es de uso mensual, no de agenda.
      const inMonth = await this.bookingRepo.count({
        where: {
          amenityId: amenity.id,
          unitId,
          deletedAt: IsNull(),
          status: In([
            ...ACTIVE_BOOKING_STATUSES,
            AmenityBookingStatus.COMPLETED,
            AmenityBookingStatus.NO_SHOW,
          ]),
          startAt: Between(monthStart, monthEnd),
        },
      });

      if (inMonth >= amenity.maxBookingsPerUnitPerMonth) {
        throw new CustomError({
          message: `Tu unidad alcanzó el límite de ${amenity.maxBookingsPerUnitPerMonth} reserva(s) mensuales en ${amenity.name}`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: AmenityErrorCode.BOOKING_UNIT_MONTHLY_LIMIT,
        });
      }
    }
  }

  /**
   * Bloqueo por cartera. Se lee el saldo materializado de la unidad
   * (`property_account_status.currentBalance`, positivo = deuda) en vez de
   * recorrer los cargos: es el mismo número que muestra el estado de cuenta.
   */
  private async assertUnitSolvent(
    amenity: Amenity,
    unitId: string,
  ): Promise<void> {
    if (!amenity.blockBookingsOnDebt) return;

    const status = await this.accountStatusRepo.findOne({
      where: { complexId: amenity.complexId, unitId },
    });

    if (status && Number(status.currentBalance) > 0) {
      throw new CustomError({
        message:
          'Tu unidad tiene saldo pendiente. Ponte al día para reservar zonas comunes.',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_UNIT_HAS_DEBT,
      });
    }
  }

  /** Revalida el cupo antes de aprobar, excluyendo la propia reserva pendiente. */
  private async assertSlotStillFree(
    amenity: Amenity,
    booking: AmenityBooking,
  ): Promise<void> {
    const overlapping = await this.availabilityService.countOverlappingBookings(
      amenity.id,
      booking.startAt,
      booking.blockedUntilAt ?? booking.endAt,
      booking.id,
    );

    if (overlapping >= amenity.maxSimultaneousBookings) {
      throw new CustomError({
        message:
          'Ya no queda cupo en esa franja: otra reserva la ocupó mientras esta esperaba aprobación',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_SLOT_UNAVAILABLE,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pasos comunes al dejar una reserva en firme: emitir el código de acceso y
   * generar el cargo. Los comparten la creación auto-aprobada y la aprobación
   * manual, que llegan al mismo estado por caminos distintos.
   */
  private async activate(
    booking: AmenityBooking,
    amenity: Amenity,
    performedByUserId: string,
  ): Promise<AmenityBooking> {
    // El código es la llave de la zona, así que no puede salir antes que el
    // pago: quien no ha pagado no entra. Una reserva sin nada que cobrar —zona
    // gratuita, o cupo del consejo— lo recibe de una vez, y las demás cuando la
    // administración registre el pago o la unidad abone el cargo.
    if (!booking.accessCode && (await this.isSettled(booking))) {
      booking.accessCode = this.generateAccessCode();
    }

    const when = this.formatWhen(booking.startAt, booking.endAt);
    // Ambos cargos vencen el día de la reserva: cobrar después de usar la zona
    // deja al complejo sin palanca.
    const dueDate = this.availabilityService.endOfDay(booking.startAt);

    if (booking.feeAmount > 0 && !booking.feeChargeId) {
      const chargeId = await this.tryCreateCharge(
        booking,
        {
          description: `Reserva ${amenity.name} — ${when}`,
          amount: booking.feeAmount,
          dueDate,
          // La tarifa pertenece al período en que se usa la zona, no a aquel en
          // que se aprobó: una reserva de enero pedida en diciembre es ingreso
          // de enero.
          period: this.periodOf(booking.startAt),
        },
        performedByUserId,
      );
      booking.feeChargeId = chargeId;
    }

    // El aseo va en un cargo propio y no sumado a la tarifa: así la
    // administración puede exonerar uno sin tocar el otro, y el estado de
    // cuenta dice qué se cobró por qué.
    if (
      booking.cleaningByComplex &&
      booking.cleaningFeeAmount > 0 &&
      !booking.cleaningChargeId
    ) {
      booking.cleaningChargeId = await this.tryCreateCharge(
        booking,
        {
          description: `Aseo de ${amenity.name} — ${when}`,
          amount: booking.cleaningFeeAmount,
          dueDate,
          period: this.periodOf(booking.startAt),
        },
        performedByUserId,
      );
    }

    return this.bookingRepo.save(booking);
  }

  /**
   * Ajusta el cobro de la tarifa al cancelar.
   *
   * Retener el total es dejar el cargo como está. Retener nada es anularlo.
   * Retener una parte obliga a anular el original y emitir otro por el valor
   * retenido: los asientos del ledger son inmutables, así que un cargo ya
   * emitido no se puede rebajar. Y una reserva que nunca llegó a aprobarse no
   * tiene cargo previo pero sí bloqueó la agenda, así que la penalización se
   * emite igual.
   */
  private async settleCancellationCharge(
    booking: AmenityBooking,
    amenity: Amenity,
    retained: number,
    actingUserId: string,
    performedByUserId: string | undefined,
    /** La reserva ya recibió plata: la retención sale de ahí, no de un cargo nuevo. */
    alreadyCollected: boolean,
  ): Promise<void> {
    booking.lateCancellationAmount = retained;

    const keepsOriginal =
      retained > 0 && retained === booking.feeAmount && !!booking.feeChargeId;
    if (keepsOriginal) return;

    if (booking.feeChargeId) {
      const cancelled = await this.financeService.cancelInternalCharge(
        booking.feeChargeId,
        retained > 0
          ? `Reserva cancelada fuera de plazo — ${amenity.name}`
          : `Reserva cancelada — ${amenity.name}`,
        performedByUserId,
      );
      if (cancelled) booking.feeChargeId = null;
    }

    if (retained <= 0) return;

    // La retención ya está en caja o en la cartera: emitir un cargo por ella
    // sería cobrarla dos veces —el residente pagó el total y encima quedaría
    // debiendo la penalización—. Lo que corresponde es devolver menos.
    if (alreadyCollected) return;

    booking.lateCancellationChargeId = await this.tryCreateCharge(
      booking,
      {
        description: `Penalización por cancelación tardía — ${amenity.name} (${this.formatWhen(booking.startAt, booking.endAt)})`,
        amount: retained,
        dueDate: this.availabilityService.endOfDay(booking.startAt),
        period: this.periodOf(booking.startAt),
      },
      actingUserId,
    );
  }

  /** "48 horas" / "2 días" — el plazo como lo entiende quien lee la notificación. */
  private formatDeadline(hours: number): string {
    if (hours === 0) return 'cancelación';
    if (hours % 24 === 0) {
      const days = hours / 24;
      return `${days} día${days === 1 ? '' : 's'}`;
    }
    return `${hours} hora${hours === 1 ? '' : 's'}`;
  }

  /** Valor en pesos, para los mensajes que lee el residente. */
  private formatMoney(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Crea un cargo sin dejar que un fallo de facturación tumbe la aprobación:
   * el residente no puede quedarse sin reserva porque finanzas falló. Se
   * registra y la administración lo cobra a mano.
   */
  private async tryCreateCharge(
    booking: AmenityBooking,
    params: {
      description: string;
      amount: number;
      dueDate: Date;
      period: string;
    },
    performedByUserId: string,
  ): Promise<string | null> {
    try {
      const { chargeId } = await this.dataSource.transaction((em) =>
        this.accountingService.emitAmenityUnitCharge(em, {
          complexId: booking.complexId,
          unitId: booking.unitId,
          amount: params.amount,
          period: params.period,
          dueDate: params.dueDate,
          documentDate: new Date(),
          description: params.description,
          createdByUserId: performedByUserId,
        }),
      );
      return chargeId;
    } catch (err: any) {
      this.logger.error(
        `No se pudo generar el cargo "${params.description}" de la reserva ${booking.id}: ${err?.message}`,
      );
      return null;
    }
  }

  /**
   * Si el aseo lo asume el conjunto. Pedirlo en una zona que no ofrece el
   * servicio se rechaza en vez de ignorarse: el residente quedaría creyendo que
   * alguien va a recoger, y la zona se entregaría sucia.
   */
  private resolveCleaningByComplex(
    amenity: Amenity,
    requested: boolean | undefined,
  ): boolean {
    if (requested !== true) return false;

    if (!amenity.cleaningServiceAvailable) {
      throw new CustomError({
        message: `${amenity.name} no ofrece servicio de aseo por parte de la administración`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.CLEANING_SERVICE_NOT_AVAILABLE,
      });
    }

    return true;
  }

  /**
   * Devuelve la plata de una reserva cancelada que ya estaba pagada.
   *
   * No se deja como saldo a favor: sale de caja con su comprobante de egreso,
   * que es el papel que la administración le muestra al residente cuando va a
   * reclamar. Lo retenido por cancelar fuera de plazo se descuenta antes: si la
   * retención se come todo lo recibido, no hay nada que devolver.
   *
   * El comprobante lleva el CÓDIGO de la reserva porque es lo único que ata la
   * salida de caja a un hecho concreto cuando alguien audite el egreso meses
   * después. Una reserva cancelada antes de aprobarse no alcanzó a tener
   * código; ahí se nombra la zona y la fecha.
   *
   * Si el complejo no tiene PUC configurado el comprobante no se puede emitir,
   * pero la devolución queda escrita en la reserva igual: que falte el plan de
   * cuentas no puede borrar el hecho de que hay que devolverle plata a alguien.
   */
  private recordRefundObligation(
    booking: AmenityBooking,
    collected: number,
    retained: number,
  ): number {
    const refund = Math.round(Math.max(0, collected - retained) * 100) / 100;
    if (refund <= 0) return 0;

    booking.refundAmount = refund;
    return refund;
  }

  /**
   * Lo que se le dice al residente sobre su código de ingreso.
   *
   * Sin código no hay entrada, así que callar es peor que cobrar: quien no sabe
   * que le falta pagar llega a portería y se devuelve. El valor va en el mismo
   * mensaje para que no tenga que buscarlo.
   */
  private accessCodeNote(booking: AmenityBooking): string {
    if (booking.accessCode) return ` Código de ingreso: ${booking.accessCode}.`;

    const owed = this.amountOwed(booking);
    if (booking.isCouncilFreeBooking || owed <= 0) return '';

    return (
      ` Para recibir tu código de ingreso debes pagar ${this.formatMoney(owed)}:` +
      ' acércate a la administración o cancela el cargo de tu unidad.'
    );
  }

  /**
   * Lo que se le cobra a la reserva por el aseo del conjunto.
   *
   * El cupo del consejo cubre el alquiler siempre, y el aseo solo si la zona lo
   * dice: es un servicio que alguien va a prestar, y quién lo paga lo decide
   * cada administración. Se congela en la reserva, así que apagar el beneficio
   * después no le cobra a quien ya reservó.
   */
  private cleaningPriceFor(
    amenity: Amenity,
    cleaningByComplex: boolean,
    usesCouncilQuota: boolean,
  ): number {
    if (!cleaningByComplex) return 0;
    if (usesCouncilQuota && amenity.councilQuotaCoversCleaning) return 0;
    return Number(amenity.cleaningFeeAmount ?? 0);
  }

  /** Lo que vale la reserva: tarifa más el aseo que asumió el conjunto. */
  private amountOwed(booking: AmenityBooking): number {
    return (
      Number(booking.feeAmount) +
      (booking.cleaningByComplex ? Number(booking.cleaningFeeAmount) : 0)
    );
  }

  /**
   * Si la reserva ya no debe nada.
   *
   * Tres caminos llevan al mismo sitio: que no hubiera nada que cobrar, que el
   * residente pagara en la administración, o que abonara el cargo en su
   * cartera. El último no lo sabe este módulo —el pago se registra en
   * finanzas— así que se consulta lo abonado sobre los cargos de la reserva.
   */
  private async isSettled(booking: AmenityBooking): Promise<boolean> {
    // Una reserva que nació gratis no tiene de qué escapar: el cupo del consejo
    // ya la pagó. Se pregunta por el hecho y no solo por el monto, para que la
    // llave de la zona no dependa de que un campo de dinero llegue en cero.
    if (booking.isCouncilFreeBooking) return true;

    const owed = this.amountOwed(booking);
    if (owed <= 0) return true;
    if (booking.directIncomeId) return true;

    const collected = await this.financeService.collectedOnCharges([
      booking.feeChargeId ?? '',
      booking.cleaningChargeId ?? '',
    ]);

    return collected + 0.01 >= owed;
  }

  /**
   * Versión por lotes de `ensureAccessCode`, para los listados.
   *
   * El residente busca su código en la lista tanto como en el detalle, así que
   * la resolución no puede vivir solo al abrir la reserva. Se consulta lo
   * abonado de todos los cargos candidatos de una vez: una consulta por fila
   * convertiría una lista de veinte reservas en veintiuna consultas.
   */
  private async ensureAccessCodes(
    bookings: AmenityBooking[],
  ): Promise<AmenityBooking[]> {
    const candidates = bookings.filter(
      (b) =>
        !b.accessCode &&
        (b.status === AmenityBookingStatus.APPROVED ||
          b.status === AmenityBookingStatus.CHECKED_IN),
    );
    if (candidates.length === 0) return bookings;

    // Solo las que dependen de la cartera necesitan ir a la base: las que no
    // deben nada, o ya se pagaron en la administración, se resuelven acá.
    const chargeIds = candidates
      .filter(
        (b) =>
          !b.isCouncilFreeBooking &&
          this.amountOwed(b) > 0 &&
          !b.directIncomeId,
      )
      .flatMap((b) => [b.feeChargeId, b.cleaningChargeId])
      .filter((id): id is string => !!id);

    const paid =
      chargeIds.length > 0
        ? await this.financeService.collectedByCharge(chargeIds)
        : {};

    const issued: AmenityBooking[] = [];
    for (const booking of candidates) {
      const owed = this.amountOwed(booking);
      const collected =
        (paid[booking.feeChargeId ?? ''] ?? 0) +
        (paid[booking.cleaningChargeId ?? ''] ?? 0);

      const settled =
        booking.isCouncilFreeBooking ||
        owed <= 0 ||
        !!booking.directIncomeId ||
        collected + 0.01 >= owed;
      if (!settled) continue;

      booking.accessCode = this.generateAccessCode();
      issued.push(booking);
    }

    if (issued.length > 0) await this.bookingRepo.save(issued);

    return bookings;
  }

  /**
   * Emite el código si la reserva ya está pagada y todavía no lo tiene.
   *
   * Hace falta porque el pago por CARTERA se registra en finanzas, que no le
   * avisa a este módulo: sin esta comprobación, el residente que paga su cuota
   * se quedaría esperando un código que nadie va a generar. Se resuelve al
   * abrir la reserva, que es justo cuando va a buscarlo.
   */
  private async ensureAccessCode(
    booking: AmenityBooking,
  ): Promise<AmenityBooking> {
    const eligible =
      booking.status === AmenityBookingStatus.APPROVED ||
      booking.status === AmenityBookingStatus.CHECKED_IN;

    if (booking.accessCode || !eligible) return booking;
    if (!(await this.isSettled(booking))) return booking;

    booking.accessCode = this.generateAccessCode();
    return this.bookingRepo.save(booking);
  }

  /** Anula el cargo del aseo cuando el servicio deja de prestarse. */
  private async voidCleaningCharge(
    booking: AmenityBooking,
    amenity: Amenity,
    performedByUserId: string | undefined,
  ): Promise<void> {
    if (!booking.cleaningChargeId) return;

    const cancelled = await this.financeService.cancelInternalCharge(
      booking.cleaningChargeId,
      `Aseo no prestado — ${amenity.name}`,
      performedByUserId,
    );
    if (cancelled) booking.cleaningChargeId = null;
  }

  /** El cambio de aseo en una frase, tal como le llega al residente. */
  private describeCleaningChange(
    booking: AmenityBooking,
    amenity: Amenity,
    before: { cleaningMinutes: number; cleaningByComplex: boolean },
  ): string {
    const parts: string[] = [];

    if (booking.cleaningByComplex !== before.cleaningByComplex) {
      parts.push(
        booking.cleaningByComplex
          ? 'el aseo lo hará la administración' +
              (booking.cleaningFeeAmount > 0
                ? ` y se cargará ${this.formatMoney(booking.cleaningFeeAmount)} a tu unidad`
                : ' sin costo')
          : 'el aseo queda a cargo de tu unidad',
      );
    }

    if (booking.cleaningMinutes !== before.cleaningMinutes) {
      parts.push(
        booking.cleaningMinutes > 0
          ? `la zona queda ocupada ${this.asHours(booking.cleaningMinutes)} más después de tu reserva para el aseo`
          : 'ya no se aparta tiempo extra para el aseo',
      );
    }

    return `En tu reserva de ${amenity.name} para el ${this.formatWhen(booking.startAt, booking.endAt)}: ${parts.join(' y ')}.`;
  }

  /** Suma minutos a una fecha sin tocar la original. */
  private addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * MINUTE_MS);
  }

  /**
   * Usuario al que se atribuye el asiento contable. La cuenta del complejo no
   * es una persona, así que en ese caso responde el propietario.
   */
  private resolveActingUserId(
    currentUser: JwtAccessPayload,
    ownerId: string,
  ): string {
    return currentUser.entityType === 'user' ? currentUser.sub : ownerId;
  }

  /** Período de facturación YYYY-MM de una fecha, en hora local del complejo. */
  private periodOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * ¿Le queda al consejero su reserva gratuita de este año en esta zona?
   *
   * El beneficio es opcional por zona y se cuenta por PERSONA y año calendario,
   * que es como lo escribe el reglamento ("una vez al año"). Se mide contra el
   * año de la reserva y no contra el de hoy: pedir en diciembre el salón de
   * enero gasta el cupo del año en que se usa la zona.
   */
  private async hasCouncilQuotaLeft(
    amenity: Amenity,
    residentId: string | null,
    isCouncilMember: boolean,
    startAt: Date,
  ): Promise<boolean> {
    if (
      amenity.councilFreeBookingsPerYear <= 0 ||
      !isCouncilMember ||
      !residentId
    )
      return false;

    const used = await this.countCouncilFreeBookings(
      amenity.id,
      residentId,
      startAt.getFullYear(),
    );
    return used < amenity.councilFreeBookingsPerYear;
  }

  /** Reservas gratuitas que ese consejero ya gastó en la zona durante el año. */
  private countCouncilFreeBookings(
    amenityId: string,
    residentId: string,
    year: number,
  ): Promise<number> {
    return this.bookingRepo.count({
      where: {
        amenityId,
        residentId,
        isCouncilFreeBooking: true,
        deletedAt: IsNull(),
        status: In(COUNCIL_QUOTA_STATUSES),
        startAt: Between(new Date(year, 0, 1), new Date(year + 1, 0, 1)),
      },
    });
  }

  /**
   * Cupo del consejo que le queda al residente autenticado en una zona.
   *
   * La app lo pregunta ANTES de reservar para poder ofrecerlo como una decisión
   * suya —un consejero puede querer guardarse el cupo para otra ocasión y pagar
   * esta— en vez de descontárselo por detrás.
   */
  async councilQuotaFor(
    amenityId: string,
    currentUser: JwtAccessPayload,
  ): Promise<AmenityCouncilQuotaResponse> {
    const amenity = await this.amenitiesService.findByIdOrFail(amenityId);
    await this.complexService.findById(amenity.complexId, currentUser);

    const year = new Date().getFullYear();
    const resident = await this.residentsService.findMyProfile(
      currentUser.sub,
      amenity.complexId,
    );

    // Se pregunta a la base y no al JWT: a quien acaban de nombrar consejero
    // el token todavía no le trae el rol, y tendría que volver a entrar para
    // que la app le ofreciera su beneficio.
    const base = {
      isCouncilMember: await this.residentsService.isCouncilUser(
        currentUser.sub,
      ),
      bookingsPerYear: amenity.councilFreeBookingsPerYear,
      year,
    };

    if (!base.isCouncilMember || amenity.councilFreeBookingsPerYear <= 0) {
      return { ...base, used: 0, remaining: 0 };
    }

    const used = await this.countCouncilFreeBookings(
      amenity.id,
      resident.id,
      year,
    );
    return {
      ...base,
      used,
      remaining: Math.max(0, amenity.councilFreeBookingsPerYear - used),
    };
  }

  /** Tarifa congelada al momento de reservar, según el modo de cobro de la zona. */
  private calculateFee(amenity: Amenity, startAt: Date, endAt: Date): number {
    if (amenity.feeType === AmenityFeeType.FREE) return 0;
    if (amenity.feeType === AmenityFeeType.PER_BOOKING)
      return Number(amenity.feeAmount);

    const hours = (endAt.getTime() - startAt.getTime()) / HOUR_MS;
    return Math.round(Number(amenity.feeAmount) * hours * 100) / 100;
  }

  /**
   * Código corto e inambiguo para portería. Se excluyen I, O, 0 y 1: el guarda
   * lo teclea leyéndolo de una pantalla, y esos caracteres se confunden.
   */
  private generateAccessCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(6);
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    return `ZC-${code}`;
  }

  /**
   * Determina a nombre de qué unidad va la reserva. El residente reserva
   * siempre para la suya: aceptar un unitId del cliente permitiría reservar a
   * nombre de un vecino.
   */
  private async resolveRequester(
    complexId: string,
    requestedUnitId: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<{
    unitId: string;
    residentId: string | null;
    requestedByName: string | null;
    isCouncilMember: boolean;
  }> {
    const isStaff = currentUser.roles?.some((role) =>
      STAFF_ROLES.includes(role),
    );

    if (!isStaff) {
      const resident = await this.residentsService.findMyProfile(
        currentUser.sub,
        complexId,
      );
      return {
        unitId: resident.unitId,
        residentId: resident.id,
        requestedByName: resident.user
          ? `${resident.user.name ?? ''} ${resident.user.lastName ?? ''}`.trim() ||
            null
          : null,
        isCouncilMember: await this.residentsService.isCouncilUser(
          resident.userId,
        ),
      };
    }

    if (!requestedUnitId) {
      throw new CustomError({
        message:
          'Debes indicar la unidad a nombre de la cual se hace la reserva',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    const unit = await this.unitService.findById(requestedUnitId, currentUser);
    if (unit.complexId !== complexId) {
      throw new CustomError({
        message: 'La unidad no pertenece a este complejo',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AmenityErrorCode.BOOKING_NOT_OWNED_BY_UNIT,
      });
    }

    // El staff reserva a nombre de una unidad, no de una persona, así que no hay
    // consejero a quien acreditarle el cupo anual. Si hace falta reconocerlo, la
    // administración exonera el cargo desde finanzas.
    return {
      unitId: unit.id,
      residentId: null,
      requestedByName: currentUser.email ?? null,
      isCouncilMember: false,
    };
  }

  /** Un residente solo alcanza las reservas de su propia unidad. */
  private async assertCanManageBooking(
    booking: AmenityBooking,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    const isStaff = currentUser.roles?.some((role) =>
      STAFF_ROLES.includes(role),
    );
    if (isStaff) return;

    const resident = await this.residentsService.findMyProfile(
      currentUser.sub,
      booking.complexId,
    );
    if (resident.unitId !== booking.unitId) {
      throw new CustomError({
        message: 'Esta reserva no pertenece a tu unidad',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: AmenityErrorCode.BOOKING_NOT_OWNED_BY_UNIT,
      });
    }
  }

  private assertStatus(
    booking: AmenityBooking,
    allowed: AmenityBookingStatus[],
  ): void {
    if (!allowed.includes(booking.status)) {
      throw new CustomError({
        message: `La reserva está en estado ${booking.status} y no admite esta operación`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AmenityErrorCode.BOOKING_INVALID_STATUS,
      });
    }
  }

  private emitUpdated(booking: AmenityBooking, amenity: Amenity): void {
    this.socketService.emitToComplex(
      booking.complexId,
      SocketEvent.AMENITY_BOOKING_UPDATED,
      {
        bookingId: booking.id,
        amenityId: amenity.id,
        amenityName: amenity.name,
        unitId: booking.unitId,
        status: booking.status,
        startAt: booking.startAt,
        endAt: booking.endAt,
      },
    );
  }

  // ─── Notificaciones ───────────────────────────────────────────────────────

  private async notifyResidents(
    booking: AmenityBooking,
    amenity: Amenity,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    const residents = await this.residentsService.findActiveByUnitInternal(
      booking.unitId,
    );
    const userIds = residents.map((r) => r.userId).filter(Boolean);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: booking.complexId,
      userIds,
      type,
      priority: NotificationPriority.NORMAL,
      title,
      body,
      entityId: booking.id,
      entityType: 'amenityBooking',
      metadata: {
        bookingId: booking.id,
        amenityId: amenity.id,
        amenityName: amenity.name,
        unitId: booking.unitId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        accessCode: booking.accessCode,
      },
    });
  }

  private async notifyStaff(
    booking: AmenityBooking,
    amenity: Amenity,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    const userIds = await this.notificationsService.findUserIdsByRoles(
      booking.complexId,
      [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    );
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: booking.complexId,
      userIds,
      type,
      priority: NotificationPriority.NORMAL,
      title,
      body,
      entityId: booking.id,
      entityType: 'amenityBooking',
      isActionable: true,
      metadata: {
        bookingId: booking.id,
        amenityId: amenity.id,
        amenityName: amenity.name,
        unitId: booking.unitId,
        startAt: booking.startAt,
        endAt: booking.endAt,
      },
    });
  }

  /**
   * La cancelación avisa a la otra parte: si canceló el residente se entera la
   * administración, y al revés. Avisar a quien acaba de pulsar el botón no
   * aporta nada.
   */
  private async notifyCancellation(
    booking: AmenityBooking,
    amenity: Amenity,
    currentUser: JwtAccessPayload,
    chargeNote: string,
  ): Promise<void> {
    const cancelledByStaff = currentUser.roles?.some((role) =>
      STAFF_ROLES.includes(role),
    );
    const when = this.formatWhen(booking.startAt, booking.endAt);

    if (cancelledByStaff) {
      await this.notifyResidents(
        booking,
        amenity,
        NotificationType.AMENITY_BOOKING_CANCELLED,
        '⚠️ Reserva cancelada',
        `La administración canceló tu reserva de ${amenity.name} del ${when}.` +
          (booking.cancellationReason
            ? ` Motivo: ${booking.cancellationReason}.`
            : ''),
      );
      return;
    }

    await this.notifyStaff(
      booking,
      amenity,
      NotificationType.AMENITY_BOOKING_CANCELLED,
      'Reserva cancelada por el residente',
      `Se liberó ${amenity.name} para el ${when}.${chargeNote}`,
    );
  }

  /**
   * Las duraciones se guardan en minutos, pero los mensajes al residente van en
   * horas: es la unidad en la que el complejo define y comunica sus reglas.
   */
  private asHours(minutes: number): string {
    const hours = minutes / 60;
    const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return `${text} hora${hours === 1 ? '' : 's'}`;
  }

  /** "3 días" — usado en las zonas que se prestan por jornadas. */
  private asDays(minutes: number): string {
    const days = Math.round(minutes / MINUTES_PER_DAY);
    return `${days} día${days === 1 ? '' : 's'}`;
  }

  /** "12/09/2026" — un día suelto dentro de un mensaje. */
  private formatDay(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  /** "12/09/2026 de 10:00 a 12:00" — el formato que va en los mensajes. */
  private formatWhen(startAt: Date, endAt: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const date = this.formatDay(startAt);

    // Reserva por jornadas: el rango cae en fronteras de día y las horas no
    // aportan nada. Se describe por los días que el residente realmente ocupa,
    // y el último es el anterior al fin exclusivo.
    const isWholeDays =
      startAt.getHours() === 0 &&
      startAt.getMinutes() === 0 &&
      endAt.getHours() === 0 &&
      endAt.getMinutes() === 0;

    if (isWholeDays) {
      const lastDay = new Date(endAt.getTime() - 1);
      const sameDay = this.formatDay(lastDay) === date;
      return sameDay ? date : `${date} al ${this.formatDay(lastDay)}`;
    }

    const from = `${pad(startAt.getHours())}:${pad(startAt.getMinutes())}`;
    const to = `${pad(endAt.getHours())}:${pad(endAt.getMinutes())}`;
    return `${date} de ${from} a ${to}`;
  }
}
