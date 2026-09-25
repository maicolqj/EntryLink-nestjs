import { AmenityBookingNoveltiesService } from './amenity-booking-novelties.service';
import { AmenityBooking } from '../entities/amenity-booking.entity';
import { AmenityBookingStatus } from '../enums/amenity-booking-status.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Novedades de portería: el guarda deja constancia de cómo recibe la zona y la
 * administración decide después el cobro. Aquí se cuida que la novedad solo
 * exista cuando la zona se usó, que un daño llegue con evidencia y que el aviso
 * le llegue a la administración.
 */

const guard: JwtAccessPayload = {
  sub: 'user-guard',
  email: 'guarda@test.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles: [ValidRoles.SECURITY_ROL],
  permissions: [],
  complexId: 'complex-1',
};

const bookingOf = (status: AmenityBookingStatus): AmenityBooking =>
  ({
    id: 'booking-1',
    complexId: 'complex-1',
    amenityId: 'amenity-1',
    unitId: 'unit-1',
    status,
    amenity: { name: 'Salón Comunal' },
    unit: { number: '301' },
  }) as unknown as AmenityBooking;

const build = (booking: AmenityBooking) => {
  const saved: unknown[] = [];
  const noveltyRepo = {
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn((data: Record<string, unknown>) => {
      const row = { id: 'novelty-1', createdAt: new Date(), ...data };
      saved.push(row);
      return Promise.resolve(row);
    }),
    find: jest.fn().mockResolvedValue([]),
  };
  const notifications = {
    findUserIdsByRoles: jest.fn().mockResolvedValue(['complex-1']),
    notify: jest.fn().mockResolvedValue(undefined),
  };

  const service = new AmenityBookingNoveltiesService(
    noveltyRepo as never,
    { findOne: jest.fn().mockResolvedValue(booking) } as never,
    {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-guard',
        name: 'Nelson',
        lastName: 'Téllez',
      }),
    } as never,
    { findById: jest.fn().mockResolvedValue({ id: 'complex-1' }) } as never,
    notifications as never,
    { emitToComplex: jest.fn() } as never,
  );

  return { service, saved, notifications };
};

describe('AmenityBookingNoveltiesService', () => {
  it('no admite novedades antes del ingreso', async () => {
    const { service, saved } = build(bookingOf(AmenityBookingStatus.APPROVED));

    await expect(
      service.create(
        {
          bookingId: 'booking-1',
          description: 'Todo en orden',
          hasDamage: false,
          photoUrls: [],
          photoHashes: [],
        },
        guard,
      ),
    ).rejects.toThrow(
      'Las novedades se registran con la zona en uso o ya entregada',
    );
    expect(saved).toHaveLength(0);
  });

  it('un daño sin foto no se radica: es la evidencia para cobrarlo', async () => {
    const { service, saved } = build(bookingOf(AmenityBookingStatus.COMPLETED));

    await expect(
      service.create(
        {
          bookingId: 'booking-1',
          description: 'Mesa rota',
          hasDamage: true,
          photoUrls: [],
          photoHashes: [],
        },
        guard,
      ),
    ).rejects.toThrow('al menos una foto');
    expect(saved).toHaveLength(0);
  });

  it('guarda quién la registró y avisa a la administración con prioridad alta si hay daño', async () => {
    const { service, notifications } = build(
      bookingOf(AmenityBookingStatus.COMPLETED),
    );

    const novelty = await service.create(
      {
        bookingId: 'booking-1',
        description: 'Mesa rota junto a la barra',
        hasDamage: true,
        photoUrls: ['https://files/1.jpg'],
        photoHashes: ['abc'],
      },
      guard,
    );

    expect(novelty.reportedByUserId).toBe('user-guard');
    expect(novelty.reportedByName).toBe('Nelson Téllez');
    expect(novelty.hasDamage).toBe(true);

    // El aviso sale sin bloquear la respuesta: se espera a que se resuelva.
    await new Promise((resolve) => setImmediate(resolve));
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.AMENITY_BOOKING_NOVELTY,
        priority: NotificationPriority.HIGH,
        entityId: 'booking-1',
      }),
    );
  });

  it('con la zona en uso también se puede dejar constancia', async () => {
    const { service, saved } = build(
      bookingOf(AmenityBookingStatus.CHECKED_IN),
    );

    await service.create(
      {
        bookingId: 'booking-1',
        description: 'Música a alto volumen',
        hasDamage: false,
        photoUrls: [],
        photoHashes: [],
      },
      guard,
    );

    expect(saved).toHaveLength(1);
  });
});
