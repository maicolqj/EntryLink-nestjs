import { AmenityBookingsService } from './amenity-bookings.service';
import { Amenity }        from '../entities/amenity.entity';
import { AmenityBooking } from '../entities/amenity-booking.entity';

import { AmenityStatus }        from '../enums/amenity-status.enum';
import { AmenityBookingMode }   from '../enums/amenity-booking-mode.enum';
import { AmenityFeeType }       from '../enums/amenity-fee-type.enum';
import { AmenityBookingStatus } from '../enums/amenity-booking-status.enum';
import { AmenityDurationUnit }  from '../enums/amenity-duration-unit.enum';

import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';

/**
 * Specs del COBRO POR DAÑOS y de los plazos en días.
 *
 * La regla: la unidad no adelanta dinero. Reservar solo genera el cargo de la
 * tarifa, si la zona la cobra. Si al recibir la zona se evidencia un daño, se
 * le carga a la unidad con una explicación escrita; si no hay daño, no se
 * genera ningún cobro extra.
 */

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

const staff: JwtAccessPayload = {
  sub: 'user-admin', email: 'admin@test.com', type: 'access', entityType: 'user',
  tokenVersion: 1, sessionId: 's1', roles: [ValidRoles.COMPLEX_ROL], permissions: [],
  complexId: 'complex-1',
} as JwtAccessPayload;

const amenityOf = (partial: Partial<Amenity> = {}): Amenity => ({
  id: 'amenity-1',
  complexId: 'complex-1',
  name: 'Salón Comunal',
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
  cancellationDeadlineDays: 1,
  cancellationDeadlineHours: 0,
  lateCancellationFeePercent: 100,
  councilFreeBookingsPerYear: 0,
  requiresApproval: true,
  feeType: AmenityFeeType.PER_BOOKING,
  feeAmount: 100_000,
  ...partial,
} as Amenity);

const bookingOf = (partial: Partial<AmenityBooking> = {}): AmenityBooking => ({
  id: 'booking-1',
  amenityId: 'amenity-1',
  complexId: 'complex-1',
  unitId: 'unit-1',
  startAt: new Date(Date.now() + 3 * DAY),
  endAt:   new Date(Date.now() + 3 * DAY + 2 * HOUR),
  attendees: 1,
  status: AmenityBookingStatus.APPROVED,
  feeAmount: 100_000,
  damageAmount: 0,
  feeChargeId: 'charge-fee',
  ...partial,
} as AmenityBooking);

interface Harness {
  service: AmenityBookingsService;
  /** Doble del ledger: es aquí donde se causa cualquier cargo a la unidad. */
  accounting: { emitAmenityUnitCharge: jest.Mock };
  finance: { cancelInternalCharge: jest.Mock };
  saved: AmenityBooking[];
}

const build = (booking: AmenityBooking, amenity = amenityOf()): Harness => {
  const saved: AmenityBooking[] = [];

  const bookingRepo = {
    findOne: jest.fn().mockResolvedValue(booking),
    find:    jest.fn().mockResolvedValue([booking]),
    save:    jest.fn(async (b: AmenityBooking) => { saved.push(b); return b; }),
    count:   jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
  };

  let seq = 0;
  const accounting = {
    emitAmenityUnitCharge: jest.fn(async () => ({
      chargeId: `charge-${++seq}`, accountingHeaderId: `header-${seq}`,
    })),
  };
  const finance = {
    cancelInternalCharge: jest.fn(async () => ({ id: 'charge-fee' })),
  };
  // La transacción se ejecuta en el acto: lo que se prueba es qué se causa,
  // no cómo TypeORM la envuelve.
  const dataSource = { transaction: (fn: (em: unknown) => unknown) => fn({}) };

  const service = new AmenityBookingsService(
    bookingRepo as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    {
      findByIdOrFail: jest.fn().mockResolvedValue(amenity),
      invalidate: jest.fn(),
      assertActive: jest.fn(),
    } as never,
    {
      countOverlappingBookings: jest.fn().mockResolvedValue(0),
      endOfDay: (d: Date) => d,
      startOfDay: (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
      addDays: (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
      getOpenWindowsForDay: jest.fn().mockResolvedValue([]),
      findBlackoutOverlapping: jest.fn().mockResolvedValue(null),
    } as never,
    { findById: jest.fn().mockResolvedValue({ id: 'complex-1', ownerId: 'owner-1' }) } as never,
    { findById: jest.fn() } as never,
    { findActiveByUnitInternal: jest.fn().mockResolvedValue([]) } as never,
    { notify: jest.fn(), findUserIdsByRoles: jest.fn().mockResolvedValue([]) } as never,
    finance as never,
    accounting as never,
    dataSource as never,
    { log: jest.fn() } as never,
    { emitToComplex: jest.fn() } as never,
  );

  return { service, accounting, finance, saved };
};

describe('AmenityBookingsService — cobro por daños', () => {

  // ── Reservar no adelanta dinero ──────────────────────────────────
  describe('al aprobar', () => {
    it('genera solo el cargo de la tarifa: la unidad no adelanta garantía', async () => {
      const booking = bookingOf({ status: AmenityBookingStatus.PENDING, feeChargeId: null });
      const { service, accounting } = build(booking);

      await service.approve('booking-1', staff);

      expect(accounting.emitAmenityUnitCharge).toHaveBeenCalledTimes(1);
      expect(accounting.emitAmenityUnitCharge.mock.calls[0][1].amount).toBe(100_000);
    });

    it('no genera ningún cargo cuando la zona es gratuita', async () => {
      const booking = bookingOf({
        status: AmenityBookingStatus.PENDING, feeChargeId: null, feeAmount: 0,
      });
      const { service, accounting } = build(booking, amenityOf({ feeType: AmenityFeeType.FREE, feeAmount: 0 }));

      await service.approve('booking-1', staff);

      expect(accounting.emitAmenityUnitCharge).not.toHaveBeenCalled();
    });
  });

  // ── El cobro por daños ───────────────────────────────────────────
  describe('cobro por daños', () => {
    const usedBooking = () => bookingOf({
      status: AmenityBookingStatus.CHECKED_IN,
      checkInAt: new Date(),
      amenity: amenityOf(),
    });

    it('carga el valor a la unidad con la explicación escrita', async () => {
      const { service, accounting, saved } = build(usedBooking());

      await service.chargeDamage({
        bookingId: 'booking-1',
        amount: 350_000,
        description: 'Se rompieron dos sillas y una mesa',
      }, staff);

      expect(accounting.emitAmenityUnitCharge).toHaveBeenCalledTimes(1);
      // [0] es el EntityManager de la transacción; [1] son los datos del cargo.
      const call = accounting.emitAmenityUnitCharge.mock.calls[0][1];
      expect(call.amount).toBe(350_000);
      expect(call.unitId).toBe('unit-1');
      // La explicación viaja al estado de cuenta: sin ella el residente reclama.
      expect(call.description).toContain('Se rompieron dos sillas');
      expect(call.description).toContain('Salón Comunal');

      const result = saved[saved.length - 1];
      expect(result.damageAmount).toBe(350_000);
      expect(result.damageDescription).toBe('Se rompieron dos sillas y una mesa');
      expect(result.damageChargeId).toBeTruthy();
      expect(result.damageChargedAt).toBeInstanceOf(Date);
      expect(result.damageChargedByUserId).toBe('user-admin');
    });

    it('no permite cobrar dos veces la misma reserva', async () => {
      const booking = usedBooking();
      booking.damageChargeId = 'charge-existente';
      const { service } = build(booking);

      await expect(
        service.chargeDamage({ bookingId: 'booking-1', amount: 100, description: 'otra vez' }, staff),
      ).rejects.toThrow(/ya tiene un cobro/i);
    });

    it('no permite cobrar antes de que el residente entregue la zona', async () => {
      // Reserva aprobada pero sin ingreso: no hay cómo constatar un daño.
      const { service, accounting } = build(bookingOf());

      await expect(
        service.chargeDamage({ bookingId: 'booking-1', amount: 100, description: 'x' }, staff),
      ).rejects.toThrow(/entrega la zona/i);

      expect(accounting.emitAmenityUnitCharge).not.toHaveBeenCalled();
    });

    it('permite cobrar sobre una reserva ya finalizada', async () => {
      const booking = bookingOf({
        status: AmenityBookingStatus.COMPLETED,
        checkInAt: null,
        amenity: amenityOf(),
      });
      const { service, saved } = build(booking);

      await service.chargeDamage({
        bookingId: 'booking-1', amount: 50_000, description: 'Vidrio roto',
      }, staff);

      expect(saved[saved.length - 1].damageAmount).toBe(50_000);
    });
  });

  // ── Sin daño no hay cobro ────────────────────────────────────────
  describe('cuando no hay daño', () => {
    it('el check-out no genera ningún cargo', async () => {
      const booking = bookingOf({
        status: AmenityBookingStatus.CHECKED_IN,
        checkInAt: new Date(),
      });
      const { service, accounting, finance, saved } = build(booking);

      await service.checkOut('booking-1', staff);

      expect(accounting.emitAmenityUnitCharge).not.toHaveBeenCalled();

      const result = saved[saved.length - 1];
      expect(result.status).toBe(AmenityBookingStatus.COMPLETED);
      expect(result.damageAmount).toBe(0);
      expect(result.damageChargeId).toBeFalsy();
    });

    it('el cierre automático del cron tampoco cobra nada', async () => {
      const booking = bookingOf({
        status: AmenityBookingStatus.CHECKED_IN,
        startAt: new Date(Date.now() - 4 * HOUR),
        endAt:   new Date(Date.now() - 2 * HOUR),
        amenity: amenityOf(),
      });
      const { service, accounting, finance } = build(booking);

      await service.autoCompleteCheckedIn();

      expect(accounting.emitAmenityUnitCharge).not.toHaveBeenCalled();
    });
  });

  // ── Plazo de cancelación en días ─────────────────────────────────
  describe('plazo de cancelación', () => {
    it('dentro del plazo anula el cargo de la tarifa', async () => {
      // Faltan 3 días y el plazo es 1: cancela a tiempo.
      const { service, finance, saved } = build(bookingOf());

      await service.cancel({ bookingId: 'booking-1' }, staff);

      expect(finance.cancelInternalCharge).toHaveBeenCalled();
      expect(saved[saved.length - 1].feeChargeId).toBeNull();
    });

    it('fuera del plazo conserva el cargo de la tarifa', async () => {
      // Faltan 3 horas y el plazo es 1 día: cancela tarde.
      const booking = bookingOf({
        startAt: new Date(Date.now() + 3 * HOUR),
        endAt:   new Date(Date.now() + 5 * HOUR),
      });
      const { service, accounting, finance, saved } = build(booking);

      await service.cancel({ bookingId: 'booking-1' }, staff);

      expect(finance.cancelInternalCharge).not.toHaveBeenCalled();
      expect(saved[saved.length - 1].feeChargeId).toBe('charge-fee');
    });

    it('un plazo de 0 días permite cancelar sin costo hasta el último momento', async () => {
      const booking = bookingOf({
        startAt: new Date(Date.now() + 1 * HOUR),
        endAt:   new Date(Date.now() + 3 * HOUR),
      });
      const { service, finance } = build(booking, amenityOf({ cancellationDeadlineDays: 0 }));

      await service.cancel({ bookingId: 'booking-1' }, staff);

      expect(finance.cancelInternalCharge).toHaveBeenCalled();
    });

    it('suma las horas a los días para formar el plazo', async () => {
      // 0 días + 48 horas de plazo, y faltan 30 horas: llega tarde.
      const booking = bookingOf({
        startAt: new Date(Date.now() + 30 * HOUR),
        endAt:   new Date(Date.now() + 32 * HOUR),
      });
      const { service, finance } = build(booking, amenityOf({
        cancellationDeadlineDays: 0, cancellationDeadlineHours: 48,
      }));

      await service.cancel({ bookingId: 'booking-1' }, staff);

      expect(finance.cancelInternalCharge).not.toHaveBeenCalled();
    });
  });

  // ── Penalización parcial ─────────────────────────────────────────
  describe('penalización por cancelación tardía', () => {
    const late = (partial: Partial<AmenityBooking> = {}) => bookingOf({
      startAt: new Date(Date.now() + 3 * HOUR),
      endAt:   new Date(Date.now() + 5 * HOUR),
      ...partial,
    });

    it('retiene solo el porcentaje configurado y reemplaza el cargo', async () => {
      const { service, accounting, finance, saved } = build(
        late(), amenityOf({ lateCancellationFeePercent: 50 }),
      );

      await service.cancel({ bookingId: 'booking-1' }, staff);

      // El cargo original se anula entero: un asiento del ledger no se rebaja.
      expect(finance.cancelInternalCharge).toHaveBeenCalled();
      expect(accounting.emitAmenityUnitCharge).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ amount: 50_000 }),
      );

      const result = saved[saved.length - 1];
      expect(result.feeChargeId).toBeNull();
      expect(result.lateCancellationAmount).toBe(50_000);
      expect(result.lateCancellationChargeId).toBe('charge-1');
    });

    it('con 0% el plazo es informativo y no cuesta nada', async () => {
      const { service, accounting, finance, saved } = build(
        late(), amenityOf({ lateCancellationFeePercent: 0 }),
      );

      await service.cancel({ bookingId: 'booking-1' }, staff);

      expect(finance.cancelInternalCharge).toHaveBeenCalled();
      expect(accounting.emitAmenityUnitCharge).not.toHaveBeenCalled();
      expect(saved[saved.length - 1].lateCancellationAmount).toBe(0);
    });

    it('cobra la penalización aunque la reserva nunca se hubiera aprobado', async () => {
      // Sin aprobar no hay cargo previo, pero la reserva sí bloqueó la agenda.
      const { service, accounting, finance } = build(
        late({ status: AmenityBookingStatus.PENDING, feeChargeId: null }),
        amenityOf({ lateCancellationFeePercent: 100 }),
      );

      await service.cancel({ bookingId: 'booking-1' }, staff);

      expect(finance.cancelInternalCharge).not.toHaveBeenCalled();
      expect(accounting.emitAmenityUnitCharge).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ amount: 100_000 }),
      );
    });

    it('una reserva sin tarifa no genera penalización', async () => {
      const { service, accounting } = build(
        late({ feeAmount: 0, feeChargeId: null, isCouncilFreeBooking: true }),
        amenityOf({ lateCancellationFeePercent: 100 }),
      );

      await service.cancel({ bookingId: 'booking-1' }, staff);

      expect(accounting.emitAmenityUnitCharge).not.toHaveBeenCalled();
    });
  });
});
