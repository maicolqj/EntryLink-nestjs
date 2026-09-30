import { VehiclesService } from './vehicles.service';
import { Vehicle } from '../entities/vehicle.entity';
import { VehicleStatus } from '../enums/vehicle-status.enum';
import { ParkingRotationConfig } from '../entities/parking-rotation-config.entity';
import { RotationIntervalUnit } from '../enums/rotation-interval-unit.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';

/**
 * La rotación, de punta a punta en el servicio: quién sale, quién vuelve, el
 * cobro y los avisos. La regla de a quién le toca vive en rotation-planner.
 */

const vehicle = (
  id: string,
  unitId: string,
  partial: Partial<Vehicle> = {},
): Vehicle =>
  ({
    id,
    unitId,
    complexId: 'complex-1',
    plate: id.toUpperCase(),
    type: 'CAR',
    status: VehicleStatus.ACTIVE,
    suspendedByRotation: false,
    rotationCycleCount: 0,
    rotationSuspendedAt: null,
    parkingSpot: null,
    ...partial,
  }) as unknown as Vehicle;

const build = (
  pool: Vehicle[],
  assets: Record<string, unknown> = {},
  holder: unknown = null,
) => {
  const qb: any = {};
  for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => pool);

  const vehicleRepo = {
    createQueryBuilder: jest.fn(() => qb),
    save: jest.fn(async (v: unknown) => v),
    findOne: jest.fn(async () => holder),
  };
  const unitAssetRepo = {
    findOne: jest.fn(
      async ({ where }: { where: { id: string } }) => assets[where.id] ?? null,
    ),
  };
  const rotationConfigRepo = { save: jest.fn(async (c: unknown) => c) };
  const financeService = {
    triggerVehicleCharges: jest.fn(async () => undefined),
  };
  const notificationsService = { notify: jest.fn(async () => []) };
  const residentsService = {
    findActiveByUnitInternal: jest.fn(async (unitId: string) => [
      { userId: `user-${unitId}` },
    ]),
  };

  const service = new VehiclesService(
    vehicleRepo as never,
    rotationConfigRepo as never,
    unitAssetRepo as never,
    {} as never, // complexService
    {} as never, // unitService
    residentsService as never,
    { log: jest.fn() } as never, // auditService
    financeService as never,
    notificationsService as never,
    { deleteByPrefix: jest.fn(async () => undefined) } as never, // cacheService
  );

  return {
    service,
    financeService,
    notificationsService,
    rotationConfigRepo,
    qb,
    vehicleRepo,
  };
};

const config = (): ParkingRotationConfig =>
  ({
    id: 'config-1',
    complexId: 'complex-1',
    rotationIntervalValue: 1,
    rotationIntervalUnit: RotationIntervalUnit.MONTHS,
    slotsByType: { CAR: 1 },
    grandCycleByType: {},
    isActive: true,
  }) as unknown as ParkingRotationConfig;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('VehiclesService — rotación de parqueadero', () => {
  it('el que vuelve se cobra de una vez; el que sale no', async () => {
    const out = vehicle('out', 'unit-out', {
      status: VehicleStatus.SUSPENDED,
      suspendedByRotation: true,
      rotationCycleCount: 1,
      rotationSuspendedAt: new Date(1),
    });
    const inside = vehicle('in', 'unit-in', { parkingSpot: 'P-07' });
    const h = build([out, inside]);

    await h.service.runRotation(config(), null);

    expect(inside.status).toBe(VehicleStatus.SUSPENDED);
    expect(inside.parkingSpot).toBeNull();
    expect(out.status).toBe(VehicleStatus.ACTIVE);
    // El único número que había pasa al que entra.
    expect(out.parkingSpot).toBe('P-07');

    expect(h.financeService.triggerVehicleCharges).toHaveBeenCalledTimes(1);
    expect(h.financeService.triggerVehicleCharges).toHaveBeenCalledWith(
      'unit-out',
      'complex-1',
    );
  });

  it('avisa a la unidad que sale y a la que vuelve', async () => {
    const out = vehicle('out', 'unit-out', {
      status: VehicleStatus.SUSPENDED,
      suspendedByRotation: true,
      rotationCycleCount: 1,
      rotationSuspendedAt: new Date(1),
    });
    const inside = vehicle('in', 'unit-in');
    const h = build([out, inside]);

    await h.service.runRotation(config(), null);
    await flush();

    const sent = h.notificationsService.notify.mock.calls.map(([n]: any[]) => [
      n.type,
      n.userIds[0],
    ]);
    expect(sent).toEqual(
      expect.arrayContaining([
        [NotificationType.VEHICLE_SUSPENDED, 'user-unit-in'],
        [NotificationType.VEHICLE_REACTIVATED, 'user-unit-out'],
      ]),
    );
  });

  it('agenda la próxima rotación desde hoy', async () => {
    const h = build([vehicle('a', 'u1'), vehicle('b', 'u2')]);
    const cfg = config();

    await h.service.runRotation(cfg, null);

    expect(cfg.lastExecutedAt).toBeInstanceOf(Date);
    expect(cfg.nextExecutionAt!.getTime()).toBeGreaterThan(
      cfg.lastExecutedAt!.getTime(),
    );
    expect(h.rotationConfigRepo.save).toHaveBeenCalledWith(cfg);
  });
});

describe('VehiclesService — parqueadero fijo', () => {
  const admin = {
    sub: 'admin',
    email: 'a@x.co',
    roles: ['COMPLEX_ROL'],
  } as never;
  const parking = {
    id: 'asset-1',
    type: 'PARKING',
    unitId: 'unit-1',
    code: 'P-203',
  };

  it('la rotación no sortea a los vehículos con parqueadero fijo', async () => {
    const h = build([vehicle('a', 'u1'), vehicle('b', 'u2')]);
    await h.service.runRotation(config(), null);

    const conditions = h.qb.andWhere.mock.calls.map(([c]: [string]) => c);
    expect(conditions).toContain('v.fixedParkingAssetId IS NULL');
  });

  it('asigna un parqueadero de la unidad: queda con su número y fuera de la rotación', async () => {
    const car = vehicle('car', 'unit-1', { suspendedByRotation: true });
    const h = build([], { 'asset-1': parking });
    jest.spyOn(h.service, 'findById').mockResolvedValue(car);

    const saved = await h.service.setFixedParking('car', 'asset-1', admin);

    expect(saved.fixedParkingAssetId).toBe('asset-1');
    expect(saved.parkingSpot).toBe('P-203');
    expect(saved.suspendedByRotation).toBe(false);
  });

  it('rechaza un parqueadero de otra unidad', async () => {
    const car = vehicle('car', 'unit-2');
    const h = build([], { 'asset-1': parking });
    jest.spyOn(h.service, 'findById').mockResolvedValue(car);

    await expect(
      h.service.setFixedParking('car', 'asset-1', admin),
    ).rejects.toThrow('no es de la unidad');
  });

  it('rechaza un parqueadero que ya tiene otro vehículo', async () => {
    const car = vehicle('car', 'unit-1');
    const h = build(
      [],
      { 'asset-1': parking },
      { id: 'otro', plate: 'ABC123' },
    );
    jest.spyOn(h.service, 'findById').mockResolvedValue(car);

    await expect(
      h.service.setFixedParking('car', 'asset-1', admin),
    ).rejects.toThrow('ya lo tiene el vehículo ABC123');
  });

  it('quitarlo lo devuelve a la rotación sin número', async () => {
    const car = vehicle('car', 'unit-1', {
      fixedParkingAssetId: 'asset-1',
      parkingSpot: 'P-203',
    } as Partial<Vehicle>);
    const h = build([]);
    jest.spyOn(h.service, 'findById').mockResolvedValue(car);

    const saved = await h.service.setFixedParking('car', null, admin);

    expect(saved.fixedParkingAssetId).toBeNull();
    expect(saved.parkingSpot).toBeUndefined();
  });
});
