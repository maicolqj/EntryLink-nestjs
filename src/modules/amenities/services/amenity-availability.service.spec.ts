import { Repository } from 'typeorm';

import { AmenityAvailabilityService, ClosedReason } from './amenity-availability.service';
import { Amenity }         from '../entities/amenity.entity';
import { AmenitySchedule } from '../entities/amenity-schedule.entity';
import { AmenityBlackout } from '../entities/amenity-blackout.entity';
import { AmenityBooking }  from '../entities/amenity-booking.entity';
import { AmenityScheduleException } from '../entities/amenity-schedule-exception.entity';

import { AmenityStatus }        from '../enums/amenity-status.enum';
import { AmenityBookingMode }   from '../enums/amenity-booking-mode.enum';
import { AmenityBookingStatus } from '../enums/amenity-booking-status.enum';
import { AmenityDurationUnit }  from '../enums/amenity-duration-unit.enum';

/**
 * Specs del motor de disponibilidad. Los repositorios se sustituyen por listas
 * en memoria: lo que se prueba es la resta horario − bloqueos − reservas, no el
 * acceso a datos.
 *
 * Las fechas se construyen con el constructor local (`new Date(y, m, d, h)`)
 * porque el servicio trabaja en hora de pared del complejo.
 */

const schedule = (
  dayOfWeek: number, openTime: string, closeTime: string,
): AmenitySchedule => ({ dayOfWeek, openTime, closeTime, isActive: true } as AmenitySchedule);

const blackout = (startAt: Date, endAt: Date, reason = 'Mantenimiento'): AmenityBlackout =>
  ({ startAt, endAt, reason } as AmenityBlackout);

const booking = (startAt: Date, endAt: Date): AmenityBooking =>
  ({ startAt, endAt, status: AmenityBookingStatus.APPROVED } as AmenityBooking);

const amenityOf = (partial: Partial<Amenity> = {}): Amenity => ({
  id: 'amenity-1',
  complexId: 'complex-1',
  name: 'Zona BBQ',
  status: AmenityStatus.ACTIVE,
  bookingMode: AmenityBookingMode.SLOT,
  durationUnit: AmenityDurationUnit.HOURS,
  slotDurationMinutes: 120,
  minDurationMinutes: 60,
  maxDurationMinutes: 480,
  capacity: 0,
  maxSimultaneousBookings: 1,
  advanceBookingDays: 30,
  minAdvanceDays: 0,
  ...partial,
} as Amenity);

/** Repo falso que ignora el `where` y devuelve siempre las filas dadas. */
const repoOf = <T>(rows: T[]): Repository<T> => ({
  find: jest.fn().mockResolvedValue(rows),
} as unknown as Repository<T>);

/** El próximo lunes a medianoche, para que las pruebas no dependan del día real. */
const nextMonday = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
  return date;
};

const at = (day: Date, hours: number, minutes = 0): Date => {
  const result = new Date(day);
  result.setHours(hours, minutes, 0, 0);
  return result;
};

const iso = (day: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
};

const exception = (
  date: string, partial: Partial<AmenityScheduleException> = {},
): AmenityScheduleException =>
  ({ date, isClosed: false, openTime: null, closeTime: null, ...partial } as AmenityScheduleException);

const build = (
  schedules: AmenitySchedule[],
  blackouts: AmenityBlackout[] = [],
  bookings: AmenityBooking[] = [],
  exceptions: AmenityScheduleException[] = [],
): AmenityAvailabilityService =>
  new AmenityAvailabilityService(
    repoOf(schedules), repoOf(blackouts), repoOf(bookings), repoOf(exceptions),
  );

describe('AmenityAvailabilityService', () => {

  // ── Generación de franjas ────────────────────────────────────────
  describe('modo SLOT', () => {
    it('parte la ventana en franjas de la duración configurada', async () => {
      const monday = nextMonday();
      const service = build([schedule(1, '08:00', '14:00')]);

      const { days } = await service.getAvailability(
        amenityOf(), iso(monday), iso(monday),
      );

      expect(days).toHaveLength(1);
      expect(days[0].isOpen).toBe(true);
      // 08–14 en franjas de 2 h → 3 franjas.
      expect(days[0].slots).toHaveLength(3);
      expect(days[0].slots[0].startAt).toEqual(at(monday, 8));
      expect(days[0].slots[2].endAt).toEqual(at(monday, 14));
    });

    it('descarta la franja que no cabe entera en la ventana', async () => {
      const monday = nextMonday();
      // 08–13 con franjas de 2 h deja 1 h suelta al final: 2 franjas, no 3.
      const service = build([schedule(1, '08:00', '13:00')]);

      const { days } = await service.getAvailability(
        amenityOf(), iso(monday), iso(monday),
      );

      expect(days[0].slots).toHaveLength(2);
      expect(days[0].slots[1].endAt).toEqual(at(monday, 12));
    });

    it('marca sin cupo la franja que ya alcanzó maxSimultaneousBookings', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '12:00')],
        [],
        [booking(at(monday, 8), at(monday, 10))],
      );

      const { days } = await service.getAvailability(
        amenityOf({ maxSimultaneousBookings: 1 }), iso(monday), iso(monday),
      );

      expect(days[0].slots[0].capacityUsed).toBe(1);
      expect(days[0].slots[0].isAvailable).toBe(false);
      // La franja siguiente sigue libre: los intervalos son semiabiertos.
      expect(days[0].slots[1].capacityUsed).toBe(0);
      expect(days[0].slots[1].isAvailable).toBe(true);
    });

    it('deja disponible la franja mientras queden cupos simultáneos', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '10:00')],
        [],
        [booking(at(monday, 8), at(monday, 10))],
      );

      const { days } = await service.getAvailability(
        amenityOf({ maxSimultaneousBookings: 4 }), iso(monday), iso(monday),
      );

      expect(days[0].slots[0].capacityUsed).toBe(1);
      expect(days[0].slots[0].isAvailable).toBe(true);
    });
  });

  // ── Bloqueos ─────────────────────────────────────────────────────
  describe('bloqueos', () => {
    it('parte la ventana en dos cuando el bloqueo cae en el medio', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '18:00')],
        [blackout(at(monday, 12), at(monday, 14))],
      );

      const { days } = await service.getAvailability(
        amenityOf(), iso(monday), iso(monday),
      );

      expect(days[0].openWindows).toHaveLength(2);
      expect(days[0].openWindows[0]).toEqual({ startAt: at(monday, 8), endAt: at(monday, 12) });
      expect(days[0].openWindows[1]).toEqual({ startAt: at(monday, 14), endAt: at(monday, 18) });
      // Ninguna franja invade el bloqueo.
      expect(days[0].slots.every(s => s.endAt <= at(monday, 12) || s.startAt >= at(monday, 14))).toBe(true);
    });

    it('cierra el día cuando el bloqueo cubre todo el horario', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '18:00')],
        [blackout(at(monday, 6), at(monday, 20))],
      );

      const { days } = await service.getAvailability(
        amenityOf(), iso(monday), iso(monday),
      );

      expect(days[0].isOpen).toBe(false);
      expect(days[0].closedReason).toBe(ClosedReason.BLOQUEADA);
      expect(days[0].slots).toHaveLength(0);
    });
  });

  // ── Días cerrados ────────────────────────────────────────────────
  describe('días sin apertura', () => {
    it('reporta SIN_HORARIO cuando el día de la semana no está programado', async () => {
      const monday = nextMonday();
      // Solo hay horario de martes; el lunes no abre.
      const service = build([schedule(2, '08:00', '18:00')]);

      const { days } = await service.getAvailability(
        amenityOf(), iso(monday), iso(monday),
      );

      expect(days[0].isOpen).toBe(false);
      expect(days[0].closedReason).toBe(ClosedReason.SIN_HORARIO);
    });

    it('reporta ZONA_INACTIVA cuando la zona está en mantenimiento', async () => {
      const monday = nextMonday();
      const service = build([schedule(1, '08:00', '18:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ status: AmenityStatus.MAINTENANCE }), iso(monday), iso(monday),
      );

      expect(days[0].isOpen).toBe(false);
      expect(days[0].closedReason).toBe(ClosedReason.ZONA_INACTIVA);
    });

    it('reporta FUERA_DE_VENTANA más allá de la anticipación permitida', async () => {
      const monday = nextMonday();
      const far = new Date(monday);
      far.setDate(far.getDate() + 21);
      // El día consultado está a 3 semanas y la zona solo admite 7 días.
      const service = build([schedule(far.getDay(), '08:00', '18:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ advanceBookingDays: 7 }), iso(far), iso(far),
      );

      expect(days[0].isOpen).toBe(false);
      expect(days[0].closedReason).toBe(ClosedReason.FUERA_DE_VENTANA);
    });
  });

  // ── Varios días y horarios partidos ──────────────────────────────
  describe('rangos', () => {
    it('devuelve un día por cada fecha del rango, inclusive', async () => {
      const monday = nextMonday();
      const wednesday = new Date(monday);
      wednesday.setDate(wednesday.getDate() + 2);

      const service = build([schedule(1, '08:00', '12:00')]);

      const { days } = await service.getAvailability(
        amenityOf(), iso(monday), iso(wednesday),
      );

      expect(days).toHaveLength(3);
      expect(days.map(d => d.date)).toEqual([iso(monday), iso(new Date(monday.getTime() + 86400000)), iso(wednesday)]);
    });

    it('respeta dos franjas del mismo día separadas por el almuerzo', async () => {
      const monday = nextMonday();
      const service = build([
        schedule(1, '08:00', '12:00'),
        schedule(1, '14:00', '18:00'),
      ]);

      const { days } = await service.getAvailability(
        amenityOf(), iso(monday), iso(monday),
      );

      expect(days[0].openWindows).toHaveLength(2);
      // 2 franjas por ventana de 4 h con slots de 2 h.
      expect(days[0].slots).toHaveLength(4);
    });

    it('rechaza un rango invertido', async () => {
      const monday = nextMonday();
      const before = new Date(monday);
      before.setDate(before.getDate() - 1);

      const service = build([schedule(1, '08:00', '12:00')]);

      await expect(
        service.getAvailability(amenityOf(), iso(monday), iso(before)),
      ).rejects.toThrow();
    });
  });

  // ── Horarios que cruzan la medianoche ────────────────────────────
  describe('franja nocturna', () => {
    it('extiende la ventana al día siguiente cuando cierra antes de abrir', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      // Salón que se presta del lunes al mediodía hasta el martes a las 5 a. m.
      const service = build([schedule(1, '12:00', '05:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      expect(days[0].isOpen).toBe(true);
      expect(days[0].openWindows).toHaveLength(1);
      expect(days[0].openWindows[0].startAt).toEqual(at(monday, 12));
      // La ventana pertenece al día en que ABRE, y termina en la madrugada
      // siguiente: es como el residente piensa la reserva del sábado.
      expect(days[0].openWindows[0].endAt).toEqual(at(tuesday, 5));
    });

    it('abre el dia completo cuando la franja va de 00:00 a 00:00', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      // "Todo el dia": la zona abre a medianoche y cierra en la siguiente.
      const service = build([schedule(1, '00:00', '00:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      expect(days[0].isOpen).toBe(true);
      expect(days[0].openWindows).toHaveLength(1);
      expect(days[0].openWindows[0].startAt).toEqual(at(monday, 0));
      expect(days[0].openWindows[0].endAt).toEqual(at(tuesday, 0));
    });

    it('genera franjas que cruzan la medianoche en modo SLOT', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      // 22:00 → 02:00 en bloques de 2 h: 22–00 y 00–02.
      const service = build([schedule(1, '22:00', '02:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ slotDurationMinutes: 120 }), iso(monday), iso(monday),
      );

      expect(days[0].slots).toHaveLength(2);
      expect(days[0].slots[0].startAt).toEqual(at(monday, 22));
      expect(days[0].slots[1].endAt).toEqual(at(tuesday, 2));
    });

    it('recorta la ventana nocturna con un bloqueo de la madrugada siguiente', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      const service = build(
        [schedule(1, '12:00', '05:00')],
        [blackout(at(tuesday, 2), at(tuesday, 8))],
      );

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      expect(days[0].openWindows).toHaveLength(1);
      expect(days[0].openWindows[0].endAt).toEqual(at(tuesday, 2));
    });

    it('una franja de 24 h abre el día completo', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      const service = build([schedule(1, '00:00', '00:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      expect(days[0].openWindows[0].startAt).toEqual(at(monday, 0));
      expect(days[0].openWindows[0].endAt).toEqual(at(tuesday, 0));
    });
  });

  // ── Excepciones por fecha ────────────────────────────────────────
  describe('excepción de fecha', () => {
    it('cierra la fecha aunque el horario semanal la tenga abierta', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '18:00')], [], [],
        [exception(iso(monday), { isClosed: true, reason: 'Asamblea' })],
      );

      const { days } = await service.getAvailability(amenityOf(), iso(monday), iso(monday));

      expect(days[0].isOpen).toBe(false);
      expect(days[0].closedReason).toBe(ClosedReason.CERRADO_ESE_DIA);
    });

    it('REEMPLAZA el horario semanal, no se suma a él', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '12:00')], [], [],
        [exception(iso(monday), { openTime: '18:00', closeTime: '22:00' })],
      );

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      // Solo la ventana de la excepción: la de la semana desaparece ese día.
      expect(days[0].openWindows).toHaveLength(1);
      expect(days[0].openWindows[0].startAt).toEqual(at(monday, 18));
      expect(days[0].openWindows[0].endAt).toEqual(at(monday, 22));
    });

    it('abre una fecha que el horario semanal tenía cerrada', async () => {
      const monday = nextMonday();
      // Sin horario de lunes; la excepción lo abre igual (festivo).
      const service = build(
        [schedule(2, '08:00', '18:00')], [], [],
        [exception(iso(monday), { openTime: '12:00', closeTime: '20:00' })],
      );

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      expect(days[0].isOpen).toBe(true);
      expect(days[0].openWindows[0].startAt).toEqual(at(monday, 12));
    });

    it('admite una excepción que cruza la medianoche', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      const service = build(
        [], [], [],
        [exception(iso(monday), { openTime: '12:00', closeTime: '05:00' })],
      );

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      expect(days[0].openWindows[0].endAt).toEqual(at(tuesday, 5));
    });

    it('no afecta a los demás días del rango', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      const service = build(
        [schedule(1, '08:00', '18:00'), schedule(2, '08:00', '18:00')], [], [],
        [exception(iso(monday), { isClosed: true })],
      );

      const { days } = await service.getAvailability(amenityOf(), iso(monday), iso(tuesday));

      expect(days[0].isOpen).toBe(false);
      expect(days[1].isOpen).toBe(true);
    });
  });

  // ── Zonas por jornadas ───────────────────────────────────────────
  describe('unidad DAYS', () => {
    it('ofrece el día completo como una sola franja, sin partirlo por horas', async () => {
      const monday = nextMonday();
      // Aunque el horario diga 08–18, una zona por jornadas se toma completa.
      const service = build([schedule(1, '08:00', '18:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ durationUnit: AmenityDurationUnit.DAYS, slotDurationMinutes: 1440 }),
        iso(monday), iso(monday),
      );

      expect(days[0].slots).toHaveLength(1);
      expect(days[0].slots[0].startAt).toEqual(at(monday, 0));
      expect(days[0].slots[0].endAt).toEqual(at(new Date(monday.getTime() + 86400000), 0));
      expect(days[0].slots[0].isAvailable).toBe(true);
    });

    it('marca el día ocupado cuando ya hay una reserva encima', async () => {
      const monday = nextMonday();
      const nextDay = new Date(monday.getTime() + 86400000);
      const service = build(
        [schedule(1, '08:00', '18:00')],
        [],
        [booking(at(monday, 0), at(nextDay, 0))],
      );

      const { days } = await service.getAvailability(
        amenityOf({ durationUnit: AmenityDurationUnit.DAYS, maxSimultaneousBookings: 1 }),
        iso(monday), iso(monday),
      );

      expect(days[0].slots[0].capacityUsed).toBe(1);
      expect(days[0].slots[0].isAvailable).toBe(false);
    });

    it('cierra el día si la zona no abre ese día de la semana', async () => {
      const monday = nextMonday();
      const service = build([schedule(2, '08:00', '18:00')]);

      const { days } = await service.getAvailability(
        amenityOf({ durationUnit: AmenityDurationUnit.DAYS }),
        iso(monday), iso(monday),
      );

      expect(days[0].isOpen).toBe(false);
      expect(days[0].slots).toHaveLength(0);
    });
  });

  // ── Modo RANGE ───────────────────────────────────────────────────
  describe('modo RANGE', () => {
    it('no genera franjas: devuelve ventanas abiertas y ocupación', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '18:00')],
        [],
        [booking(at(monday, 10), at(monday, 13))],
      );

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE }), iso(monday), iso(monday),
      );

      expect(days[0].slots).toHaveLength(0);
      expect(days[0].openWindows).toHaveLength(1);
      expect(days[0].busy).toEqual([
        { startAt: at(monday, 10), endAt: at(monday, 13), bookingsCount: 1 },
      ]);
    });

    it('agrupa reservas idénticas en un solo intervalo ocupado', async () => {
      const monday = nextMonday();
      const service = build(
        [schedule(1, '08:00', '18:00')],
        [],
        [
          booking(at(monday, 10), at(monday, 12)),
          booking(at(monday, 10), at(monday, 12)),
        ],
      );

      const { days } = await service.getAvailability(
        amenityOf({ bookingMode: AmenityBookingMode.RANGE, maxSimultaneousBookings: 3 }),
        iso(monday), iso(monday),
      );

      expect(days[0].busy).toHaveLength(1);
      expect(days[0].busy[0].bookingsCount).toBe(2);
    });
  });

  // ── Periodos continuos (reservas que cruzan la medianoche) ───────
  describe('getContinuousWindowsForDay', () => {
    it('une el dia con el siguiente cuando la zona no cierra en la medianoche', async () => {
      const monday = nextMonday();
      const wednesday = new Date(monday.getTime() + 2 * 86400000);
      // Lunes y martes abiertos todo el dia: entre ellos no hay cierre real.
      const service = build([schedule(1, '00:00', '00:00'), schedule(2, '00:00', '00:00')]);

      const windows = await service.getContinuousWindowsForDay('amenity-1', monday);

      expect(windows).toHaveLength(1);
      expect(windows[0].startAt).toEqual(at(monday, 0));
      expect(windows[0].endAt).toEqual(at(wednesday, 0));
    });

    it('deja periodos separados cuando la zona si cierra entre un dia y otro', async () => {
      const monday = nextMonday();
      const service = build([schedule(1, '08:00', '18:00'), schedule(2, '08:00', '18:00')]);

      const windows = await service.getContinuousWindowsForDay('amenity-1', monday);

      expect(windows).toHaveLength(2);
      expect(windows[0].endAt).toEqual(at(monday, 18));
    });

    it('parte el periodo con un bloqueo de la madrugada', async () => {
      const monday = nextMonday();
      const tuesday = new Date(monday.getTime() + 86400000);
      const service = build(
        [schedule(1, '00:00', '00:00'), schedule(2, '00:00', '00:00')],
        [blackout(at(tuesday, 0), at(tuesday, 2))],
      );

      const windows = await service.getContinuousWindowsForDay('amenity-1', monday);

      expect(windows).toHaveLength(2);
      expect(windows[0].endAt).toEqual(at(monday, 24));
      expect(windows[1].startAt).toEqual(at(tuesday, 2));
    });
  });
});
