import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, IsNull, LessThan, MoreThan } from 'typeorm';

import { Amenity } from '../entities/amenity.entity';
import { AmenitySchedule } from '../entities/amenity-schedule.entity';
import { AmenityBlackout } from '../entities/amenity-blackout.entity';
import { AmenityScheduleException } from '../entities/amenity-schedule-exception.entity';
import { AmenityBooking } from '../entities/amenity-booking.entity';

import { AmenityStatus } from '../enums/amenity-status.enum';
import { AmenityBookingMode } from '../enums/amenity-booking-mode.enum';
import { AmenityDurationUnit } from '../enums/amenity-duration-unit.enum';
import { ACTIVE_BOOKING_STATUSES } from '../enums/amenity-booking-status.enum';

import {
  AmenityAvailabilityDay,
  AmenityAvailabilityResponse,
  AmenityBusyRange,
  AmenitySlot,
  AmenityTimeWindow,
} from '../dto/responses/amenity-availability.response';

import { CustomError } from '../../shared/utils/errors.utils';
import { AmenityErrorCode } from '../../shared/constans/error-codes.constants';

/** Máximo de días que se pueden pedir en una sola consulta de disponibilidad. */
const MAX_RANGE_DAYS = 62;

const MINUTE_MS = 60_000;

/** Motivos por los que un día no admite reservas. */
export const ClosedReason = {
  ZONA_INACTIVA: 'ZONA_INACTIVA',
  SIN_HORARIO: 'SIN_HORARIO',
  BLOQUEADA: 'BLOQUEADA',
  FUERA_DE_VENTANA: 'FUERA_DE_VENTANA',
  /** La administración marcó esa fecha concreta como cerrada. */
  CERRADO_ESE_DIA: 'CERRADO_ESE_DIA',
} as const;

/**
 * Motor de disponibilidad de zonas comunes.
 *
 * La disponibilidad es una resta, en este orden:
 *
 *   horario semanal  −  bloqueos puntuales  −  reservas activas
 *
 * Todo el módulo trata los intervalos como semiabiertos [start, end): una
 * reserva 10:00–12:00 y otra 12:00–14:00 no se solapan. Sin esa convención
 * cada franja contigua se pisaría con la siguiente y media agenda quedaría
 * inservible.
 *
 * Las horas del horario (`open_time`/`close_time`) son horas de pared del
 * complejo; el proceso corre con TZ=America/Bogota, así que combinarlas con una
 * fecha local produce el instante correcto.
 */
@Injectable()
export class AmenityAvailabilityService {
  constructor(
    @InjectRepository(AmenitySchedule)
    private readonly scheduleRepo: Repository<AmenitySchedule>,
    @InjectRepository(AmenityBlackout)
    private readonly blackoutRepo: Repository<AmenityBlackout>,
    @InjectRepository(AmenityBooking)
    private readonly bookingRepo: Repository<AmenityBooking>,
    @InjectRepository(AmenityScheduleException)
    private readonly exceptionRepo: Repository<AmenityScheduleException>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calcula la disponibilidad día a día en el rango [from, to] (ambos inclusive,
   * fechas calendario YYYY-MM-DD en hora local del complejo).
   */
  async getAvailability(
    amenity: Amenity,
    from: string,
    to: string,
  ): Promise<AmenityAvailabilityResponse> {
    const fromDate = this.parseLocalDate(from);
    const toDate = this.parseLocalDate(to);

    if (toDate < fromDate) {
      throw new CustomError({
        message: 'El rango de fechas es inválido: "to" es anterior a "from"',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_INVALID_RANGE,
      });
    }

    const totalDays =
      Math.round(
        (toDate.getTime() - fromDate.getTime()) / (24 * 60 * MINUTE_MS),
      ) + 1;
    if (totalDays > MAX_RANGE_DAYS) {
      throw new CustomError({
        message: `El rango no puede superar ${MAX_RANGE_DAYS} días`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: AmenityErrorCode.BOOKING_INVALID_RANGE,
      });
    }

    // Se consulta una sola vez todo el rango y luego se reparte por día: pedir
    // horarios, bloqueos y reservas por cada día serían 3×N consultas.
    const rangeStart = fromDate;
    // +2: la ventana nocturna del último día del rango termina en la madrugada
    // del siguiente, y sus reservas y bloqueos cuentan para el cupo.
    const rangeEnd = this.addDays(toDate, 2);

    const [schedules, blackouts, bookings, exceptions] = await Promise.all([
      this.loadSchedules(amenity.id),
      this.loadBlackouts(amenity.id, rangeStart, rangeEnd),
      this.loadActiveBookings(amenity.id, rangeStart, rangeEnd),
      this.loadExceptions(
        amenity.id,
        this.formatLocalDate(rangeStart),
        this.formatLocalDate(rangeEnd),
      ),
    ]);

    const now = new Date();
    const earliest = new Date(
      now.getTime() + amenity.minAdvanceDays * 24 * 60 * MINUTE_MS,
    );
    const latestStart = this.endOfDay(
      this.addDays(this.startOfDay(now), amenity.advanceBookingDays),
    );

    const days: AmenityAvailabilityDay[] = [];

    for (let d = 0; d < totalDays; d++) {
      const dayStart = this.addDays(fromDate, d);
      days.push(
        this.buildDay(
          amenity,
          dayStart,
          schedules,
          blackouts,
          bookings,
          exceptions,
          earliest,
          latestStart,
        ),
      );
    }

    return { amenityId: amenity.id, days };
  }

  /**
   * Ventanas de apertura de un día concreto, ya descontados los bloqueos.
   * La usa el validador de reservas para saber si un rango cabe en el horario.
   */
  async getOpenWindowsForDay(
    amenityId: string,
    dayStart: Date,
  ): Promise<AmenityTimeWindow[]> {
    // +2 días: la ventana puede terminar en la madrugada siguiente y hay que
    // ver los bloqueos que caen ahí.
    const dayEnd = this.addDays(dayStart, 2);

    const dateKey = this.formatLocalDate(dayStart);
    const [schedules, blackouts, exceptions] = await Promise.all([
      this.loadSchedules(amenityId),
      this.loadBlackouts(amenityId, dayStart, dayEnd),
      this.loadExceptions(amenityId, dateKey, dateKey),
    ]);

    // Misma fuente de verdad que el listado de disponibilidad: si aquí se
    // ignorara la excepción, se podría reservar un día que el calendario
    // muestra cerrado.
    return this.openWindowsForDay(
      dayStart,
      schedules,
      blackouts,
      exceptions[0] ?? null,
    );
  }

  /**
   * Ventanas de apertura vistas como periodos continuos, uniendo las que se
   * tocan en la medianoche.
   *
   * Una zona abierta las 24 horas produce una ventana por cada día del
   * calendario, y el cierre de una coincide exactamente con la apertura de la
   * siguiente: ahí no hay un cierre real. Si se miran día por día, una reserva
   * que arranca el sábado a las 2 p. m. no puede pasar de la medianoche y la
   * duración máxima de la zona queda inalcanzable —el residente no logra
   * entregar el salón el domingo a las 2 p. m. aunque la zona lo permita—.
   *
   * Se miran `lookaheadDays` días hacia adelante porque una reserva por horas
   * dura como mucho 24 h y puede arrancar dentro de una ventana que ya venía
   * de la madrugada.
   */
  async getContinuousWindowsForDay(
    amenityId: string,
    dayStart: Date,
    lookaheadDays = 2,
  ): Promise<AmenityTimeWindow[]> {
    // +2 sobre el último día mirado: su ventana puede terminar en la madrugada
    // siguiente y un bloqueo de esa madrugada tiene que recortarla.
    const rangeEnd = this.addDays(dayStart, lookaheadDays + 2);

    const [schedules, blackouts, exceptions] = await Promise.all([
      this.loadSchedules(amenityId),
      this.loadBlackouts(amenityId, dayStart, rangeEnd),
      this.loadExceptions(
        amenityId,
        this.formatLocalDate(dayStart),
        this.formatLocalDate(rangeEnd),
      ),
    ]);

    const windows: AmenityTimeWindow[] = [];
    for (let d = 0; d <= lookaheadDays; d++) {
      const day = this.addDays(dayStart, d);
      const date = this.formatLocalDate(day);
      windows.push(
        ...this.openWindowsForDay(
          day,
          schedules,
          blackouts,
          exceptions.find((e) => e.date === date) ?? null,
        ),
      );
    }

    // `mergeWindows` une las que se tocan, así que un día cerrado en medio deja
    // el hueco y corta el periodo: la reserva no lo puede saltar.
    return this.mergeWindows(windows);
  }

  /**
   * Cuántas reservas activas se cruzan con [startAt, endAt) en la zona.
   * `excludeBookingId` permite reagendar una reserva sin que compita consigo misma.
   */
  async countOverlappingBookings(
    amenityId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
  ): Promise<number> {
    const qb = this.bookingRepo
      .createQueryBuilder('b')
      .where('b.amenityId = :amenityId', { amenityId })
      .andWhere('b.deletedAt IS NULL')
      .andWhere('b.status IN (:...statuses)', {
        statuses: ACTIVE_BOOKING_STATUSES,
      })
      // Solapamiento de intervalos semiabiertos: se cruzan si cada uno empieza
      // antes de que el otro termine.
      .andWhere('b.startAt < :endAt', { endAt })
      .andWhere('b.endAt   > :startAt', { startAt });

    if (excludeBookingId) {
      qb.andWhere('b.id != :excludeBookingId', { excludeBookingId });
    }

    return qb.getCount();
  }

  /** Bloqueo que se cruce con el rango, o null si no hay ninguno. */
  async findBlackoutOverlapping(
    amenityId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<AmenityBlackout | null> {
    return this.blackoutRepo.findOne({
      where: {
        amenityId,
        startAt: LessThan(endAt),
        endAt: MoreThan(startAt),
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CARGA DE DATOS
  // ═══════════════════════════════════════════════════════════════════════════

  private loadSchedules(amenityId: string): Promise<AmenitySchedule[]> {
    return this.scheduleRepo.find({
      where: { amenityId, isActive: true },
      order: { dayOfWeek: 'ASC', openTime: 'ASC' },
    });
  }

  private loadBlackouts(
    amenityId: string,
    from: Date,
    to: Date,
  ): Promise<AmenityBlackout[]> {
    return this.blackoutRepo.find({
      where: { amenityId, startAt: LessThan(to), endAt: MoreThan(from) },
      order: { startAt: 'ASC' },
    });
  }

  /** Excepciones cuya fecha cae en [from, to], ambas en formato YYYY-MM-DD. */
  private loadExceptions(
    amenityId: string,
    from: string,
    to: string,
  ): Promise<AmenityScheduleException[]> {
    return this.exceptionRepo.find({
      where: { amenityId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
  }

  private loadActiveBookings(
    amenityId: string,
    from: Date,
    to: Date,
  ): Promise<AmenityBooking[]> {
    return this.bookingRepo.find({
      where: {
        amenityId,
        deletedAt: IsNull(),
        status: In(ACTIVE_BOOKING_STATUSES),
        startAt: LessThan(to),
        endAt: MoreThan(from),
      },
      order: { startAt: 'ASC' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCCIÓN DEL DÍA
  // ═══════════════════════════════════════════════════════════════════════════

  private buildDay(
    amenity: Amenity,
    dayStart: Date,
    schedules: AmenitySchedule[],
    blackouts: AmenityBlackout[],
    bookings: AmenityBooking[],
    exceptions: AmenityScheduleException[],
    earliest: Date,
    latestStart: Date,
  ): AmenityAvailabilityDay {
    const date = this.formatLocalDate(dayStart);
    const dayEnd = this.addDays(dayStart, 1);

    const dayBookings = bookings.filter(
      (b) => b.startAt < dayEnd && b.endAt > dayStart,
    );
    const busy = this.buildBusyRanges(dayBookings);

    const closed = (reason: string): AmenityAvailabilityDay => ({
      date,
      isOpen: false,
      closedReason: reason,
      openWindows: [],
      slots: [],
      busy,
    });

    if (amenity.status !== AmenityStatus.ACTIVE)
      return closed(ClosedReason.ZONA_INACTIVA);

    // Un día completamente fuera de la ventana de anticipación no se reporta
    // como cerrado por horario: el residente debe distinguir "cerrado hoy" de
    // "todavía no se puede reservar tan lejos".
    if (dayEnd <= earliest || dayStart > latestStart)
      return closed(ClosedReason.FUERA_DE_VENTANA);

    // La excepción de la fecha manda sobre la regla semanal: si dice cerrado,
    // no importa que el día de la semana tenga horario.
    const exception = exceptions.find((e) => e.date === date) ?? null;
    if (exception?.isClosed) return closed(ClosedReason.CERRADO_ESE_DIA);

    const hasHours = exception
      ? true
      : schedules.some((s) => s.dayOfWeek === dayStart.getDay());
    if (!hasHours) return closed(ClosedReason.SIN_HORARIO);

    const openWindows = this.openWindowsForDay(
      dayStart,
      schedules,
      blackouts,
      exception,
    );
    if (openWindows.length === 0) return closed(ClosedReason.BLOQUEADA);

    // Una zona por jornadas se toma o se deja completa: la franja reservable es
    // el día entero, sin importar a qué hora abra. Partirla en bloques horarios
    // ofrecería algo que el validador de reservas después rechaza.
    const slots =
      amenity.durationUnit === AmenityDurationUnit.DAYS
        ? this.buildWholeDaySlot(
            amenity,
            dayStart,
            dayEnd,
            dayBookings,
            earliest,
            latestStart,
          )
        : amenity.bookingMode === AmenityBookingMode.SLOT
          ? // Se pasan TODAS las reservas del rango y no solo las del día: una
            // franja nocturna cae en la madrugada siguiente y su cupo lo ocupan
            // reservas que, por fecha, pertenecen al día de después.
            this.buildSlots(
              amenity,
              openWindows,
              bookings,
              earliest,
              latestStart,
            )
          : [];

    return { date, isOpen: true, closedReason: null, openWindows, slots, busy };
  }

  /**
   * Horario del día menos los bloqueos. Devuelve ventanas ordenadas y sin
   * solapamiento; un bloqueo que parta una ventana en dos produce dos ventanas.
   */
  private openWindowsForDay(
    dayStart: Date,
    schedules: AmenitySchedule[],
    blackouts: AmenityBlackout[],
    exception?: AmenityScheduleException | null,
  ): AmenityTimeWindow[] {
    // Dos días: una ventana nocturna termina en la madrugada del siguiente, y
    // un bloqueo de esa madrugada tiene que recortarla.
    const dayEnd = this.addDays(dayStart, 2);

    // Una hora de cierre menor o igual a la de apertura significa que la zona
    // cierra al DÍA SIGUIENTE: es como se presta un salón que va del sábado al
    // mediodía hasta el domingo a las 5 a. m. La ventana pertenece al día en
    // que ABRE, que es como el residente la piensa ("reservo el sábado").
    // Una excepción con horas REEMPLAZA la regla semanal de esa fecha; no se
    // suma a ella. Y una que cierra deja el día sin ventanas.
    const source: { openTime: string; closeTime: string }[] = exception
      ? exception.isClosed || !exception.openTime || !exception.closeTime
        ? []
        : [{ openTime: exception.openTime, closeTime: exception.closeTime }]
      : schedules
          .filter((s) => s.dayOfWeek === dayStart.getDay())
          .map((s) => ({ openTime: s.openTime, closeTime: s.closeTime }));

    const raw = source
      .map((s) => {
        const startAt = this.combine(dayStart, s.openTime);
        const sameDayEnd = this.combine(dayStart, s.closeTime);
        const endAt =
          sameDayEnd > startAt
            ? sameDayEnd
            : this.combine(this.addDays(dayStart, 1), s.closeTime);
        return { startAt, endAt };
      })
      .filter((w) => w.endAt > w.startAt);

    const merged = this.mergeWindows(raw);

    const dayBlackouts = blackouts
      .filter((b) => b.startAt < dayEnd && b.endAt > dayStart)
      .map((b) => ({ startAt: b.startAt, endAt: b.endAt }));

    return this.subtractWindows(merged, dayBlackouts);
  }

  /**
   * Parte las ventanas abiertas en franjas de `slotDurationMinutes` y marca
   * cuáles siguen teniendo cupo. Una franja que no cabe entera en la ventana se
   * descarta: ofrecer media franja rompería la promesa de duración fija.
   */
  private buildSlots(
    amenity: Amenity,
    openWindows: AmenityTimeWindow[],
    dayBookings: AmenityBooking[],
    earliest: Date,
    latestStart: Date,
  ): AmenitySlot[] {
    const stepMs = amenity.slotDurationMinutes * MINUTE_MS;
    const slots: AmenitySlot[] = [];

    for (const window of openWindows) {
      for (
        let start = window.startAt.getTime();
        start + stepMs <= window.endAt.getTime();
        start += stepMs
      ) {
        const startAt = new Date(start);
        const endAt = new Date(start + stepMs);

        const capacityUsed = dayBookings.filter(
          (b) => b.startAt < endAt && b.endAt > startAt,
        ).length;

        const withinWindow = startAt >= earliest && startAt <= latestStart;

        slots.push({
          startAt,
          endAt,
          capacityTotal: amenity.maxSimultaneousBookings,
          capacityUsed,
          isAvailable:
            withinWindow && capacityUsed < amenity.maxSimultaneousBookings,
        });
      }
    }

    return slots;
  }

  /**
   * Franja única que cubre el día completo, para las zonas que se alquilan por
   * jornadas. El cliente encadena días contiguos para armar un alquiler de
   * varios días.
   */
  private buildWholeDaySlot(
    amenity: Amenity,
    dayStart: Date,
    dayEnd: Date,
    dayBookings: AmenityBooking[],
    earliest: Date,
    latestStart: Date,
  ): AmenitySlot[] {
    const capacityUsed = dayBookings.filter(
      (b) => b.startAt < dayEnd && b.endAt > dayStart,
    ).length;
    const withinWindow = dayEnd > earliest && dayStart <= latestStart;

    return [
      {
        startAt: dayStart,
        endAt: dayEnd,
        capacityTotal: amenity.maxSimultaneousBookings,
        capacityUsed,
        isAvailable:
          withinWindow && capacityUsed < amenity.maxSimultaneousBookings,
      },
    ];
  }

  /** Reservas activas del día como intervalos, sin datos del titular. */
  private buildBusyRanges(dayBookings: AmenityBooking[]): AmenityBusyRange[] {
    const byRange = new Map<string, AmenityBusyRange>();

    for (const b of dayBookings) {
      const key = `${b.startAt.getTime()}-${b.endAt.getTime()}`;
      const existing = byRange.get(key);
      if (existing) {
        existing.bookingsCount += 1;
      } else {
        byRange.set(key, {
          startAt: b.startAt,
          endAt: b.endAt,
          bookingsCount: 1,
        });
      }
    }

    return [...byRange.values()].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÁLGEBRA DE INTERVALOS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Une ventanas solapadas o contiguas en una sola. */
  private mergeWindows(windows: AmenityTimeWindow[]): AmenityTimeWindow[] {
    if (windows.length === 0) return [];

    const sorted = [...windows].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    );
    const merged: AmenityTimeWindow[] = [{ ...sorted[0] }];

    for (const window of sorted.slice(1)) {
      const last = merged[merged.length - 1];
      if (window.startAt <= last.endAt) {
        if (window.endAt > last.endAt) last.endAt = window.endAt;
      } else {
        merged.push({ ...window });
      }
    }

    return merged;
  }

  /** Resta los intervalos `cuts` de las ventanas `windows`. */
  private subtractWindows(
    windows: AmenityTimeWindow[],
    cuts: AmenityTimeWindow[],
  ): AmenityTimeWindow[] {
    let result = windows.map((w) => ({ ...w }));

    for (const cut of cuts) {
      const next: AmenityTimeWindow[] = [];

      for (const window of result) {
        // Sin cruce: la ventana sobrevive intacta.
        if (cut.endAt <= window.startAt || cut.startAt >= window.endAt) {
          next.push(window);
          continue;
        }
        if (cut.startAt > window.startAt) {
          next.push({ startAt: window.startAt, endAt: cut.startAt });
        }
        if (cut.endAt < window.endAt) {
          next.push({ startAt: cut.endAt, endAt: window.endAt });
        }
      }

      result = next;
    }

    return result.filter((w) => w.endAt > w.startAt);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FECHAS (hora local del complejo — el proceso corre con TZ=America/Bogota)
  // ═══════════════════════════════════════════════════════════════════════════

  /** 'YYYY-MM-DD' → medianoche local de ese día. */
  parseLocalDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  /** Date → 'YYYY-MM-DD' en hora local. */
  formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** Combina un día con una hora de pared 'HH:mm' o 'HH:mm:ss'. */
  combine(dayStart: Date, time: string): Date {
    const [hours, minutes] = time.split(':').map(Number);
    const result = new Date(dayStart);
    result.setHours(hours, minutes ?? 0, 0, 0);
    return result;
  }

  startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  endOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}
