import { VehiclesService } from './vehicles.service';
import { VehicleStatus } from '../enums/vehicle-status.enum';

/**
 * La foto del vehículo: la administración la cambia en cualquiera del
 * conjunto; el residente, solo en los de su unidad. Validar el conjunto no
 * basta — dejaría cambiar la foto del carro de un vecino.
 */

const resident = { sub: 'user-me', roles: ['RESIDENT_ROL'] } as never;
const admin = {
  sub: 'complex-1',
  roles: ['COMPLEX_ROL'],
  complexId: 'complex-1',
} as never;

const build = (vehicle: unknown, household: { userId: string }[] = []) => {
  const vehicleRepo = {
    findOne: jest.fn().mockResolvedValue(vehicle),
  };
  const residentsService = {
    findActiveByUnitInternal: jest.fn().mockResolvedValue(household),
  };
  const complexService = {
    assertAccess: jest.fn().mockResolvedValue(undefined),
  };
  const service = new VehiclesService(
    vehicleRepo as never,
    {} as never, // rotationConfigRepo
    {} as never, // unitAssetRepo
    complexService as never,
    {} as never, // unitService
    residentsService as never,
    {} as never, // auditService
    {} as never, // financeService
    {} as never, // notificationsService
    {} as never, // cacheService
  );
  return { service, residentsService, complexService };
};

const car = (partial: Record<string, unknown> = {}) => ({
  id: 'veh-1',
  unitId: 'unit-1',
  complexId: 'complex-1',
  status: VehicleStatus.ACTIVE,
  ...partial,
});

describe('VehiclesService.assertCanChangePhoto', () => {
  it('el residente puede en un vehículo de su unidad', async () => {
    const h = build(car(), [{ userId: 'user-me' }]);
    await expect(
      h.service.assertCanChangePhoto('veh-1', resident),
    ).resolves.toMatchObject({ id: 'veh-1' });
    expect(h.residentsService.findActiveByUnitInternal).toHaveBeenCalledWith(
      'unit-1',
    );
  });

  it('el residente NO puede en el vehículo de un vecino', async () => {
    const h = build(car(), [{ userId: 'user-vecino' }]);
    await expect(
      h.service.assertCanChangePhoto('veh-1', resident),
    ).rejects.toThrow(
      'Solo puedes cambiar la foto de los vehículos de tu unidad',
    );
  });

  it('la administración puede en cualquiera del conjunto', async () => {
    const h = build(car());
    await expect(
      h.service.assertCanChangePhoto('veh-1', admin),
    ).resolves.toMatchObject({ id: 'veh-1' });
    expect(h.complexService.assertAccess).toHaveBeenCalled();
    expect(h.residentsService.findActiveByUnitInternal).not.toHaveBeenCalled();
  });

  it('un vehículo dado de baja no recibe foto', async () => {
    const h = build(car({ status: VehicleStatus.REMOVED }), [
      { userId: 'user-me' },
    ]);
    await expect(
      h.service.assertCanChangePhoto('veh-1', resident),
    ).rejects.toThrow('ya no está registrado');
  });

  it('vehículo inexistente', async () => {
    const h = build(null);
    await expect(
      h.service.assertCanChangePhoto('veh-x', resident),
    ).rejects.toThrow('no encontrado');
  });
});
