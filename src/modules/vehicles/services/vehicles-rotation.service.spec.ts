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

const vehicle = (id: string, unitId: string, partial: Partial<Vehicle> = {}): Vehicle =>
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

const build = (pool: Vehicle[]) => {
  const qb: any = {};
  for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => pool);

  const vehicleRepo = {
    createQueryBuilder: jest.fn(() => qb),
    save: jest.fn(async (v: unknown) => v),
  };
  const rotationConfigRepo = { save: jest.fn(async (c: unknown) => c) };
  const financeService = { triggerVehicleCharges: jest.fn(async () => undefined) };
  const notificationsService = { notify: jest.fn(async () => []) };
  const residentsService = {
    findActiveByUnitInternal: jest.fn(async (unitId: string) => [{ userId: `user-${unitId}` }]),
  };

  const service = new VehiclesService(
    vehicleRepo as never,
    rotationConfigRepo as never,
    {} as never, // complexService
    {} as never, // unitService
    residentsService as never,
    { log: jest.fn() } as never, // auditService
    financeService as never,
    notificationsService as never,
    { deleteByPrefix: jest.fn(async () => undefined) } as never, // cacheService
  );

  return { service, financeService, notificationsService, rotationConfigRepo };
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
    expect(h.financeService.triggerVehicleCharges).toHaveBeenCalledWith('unit-out', 'complex-1');
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

    const sent = h.notificationsService.notify.mock.calls.map(([n]: any[]) => [n.type, n.userIds[0]]);
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
    expect(cfg.nextExecutionAt!.getTime()).toBeGreaterThan(cfg.lastExecutedAt!.getTime());
    expect(h.rotationConfigRepo.save).toHaveBeenCalledWith(cfg);
  });
});
