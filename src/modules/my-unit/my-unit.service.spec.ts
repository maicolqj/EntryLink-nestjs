import { MyUnitService } from './my-unit.service';
import { ResidentType } from '../residents/enums/resident-type.enum';
import { ResidentStatus } from '../residents/enums/resident-status.enum';
import { VehicleStatus } from '../vehicles/enums/vehicle-status.enum';

/**
 * "Mi unidad": la unidad sale de la ficha activa de quien pregunta, nunca de un
 * id que mande la app, y los integrantes son solo los de esa unidad.
 */

const COMPLEX_ID = 'complex-1';
const user = { sub: 'user-me', roles: ['RESIDENT_ROL'] } as never;

const resident = (overrides: Record<string, unknown>) => ({
  id: 'res-x',
  type: ResidentType.FAMILY_MEMBER,
  isMainResident: false,
  startDate: new Date('2025-01-01'),
  status: ResidentStatus.ACTIVE,
  user: { name: 'Ana', lastName: 'Pérez', phoneNumber: '3001112233' },
  ...overrides,
});

const build = (me: unknown, household: unknown[] = []) => {
  const residentRepo = {
    findOne: jest.fn().mockResolvedValue(me),
    find: jest.fn().mockResolvedValue(household),
  };
  const vehicleRepo = { find: jest.fn().mockResolvedValue([{ id: 'veh-1' }]) };
  const rotationRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue({ nextExecutionAt: new Date('2026-11-01T11:00:00.000Z') }),
  };
  const assetService = {
    listForUnit: jest.fn().mockResolvedValue([{ id: 'asset-1' }]),
  };
  const service = new MyUnitService(
    residentRepo as never,
    vehicleRepo as never,
    rotationRepo as never,
    assetService as never,
  );
  return { service, residentRepo, vehicleRepo, assetService };
};

describe('MyUnitService', () => {
  const me = resident({
    id: 'res-me',
    unit: { id: 'unit-1', number: '502' },
  });

  it('busca la ficha ACTIVA del usuario en ese conjunto', async () => {
    const h = build(me, [me]);
    await h.service.find(COMPLEX_ID, user);

    const [{ where }] = h.residentRepo.findOne.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where).toMatchObject({
      userId: 'user-me',
      complexId: COMPLEX_ID,
      status: ResidentStatus.ACTIVE,
    });
  });

  it('sin unidad activa responde que no la tiene', async () => {
    const h = build(null);
    await expect(h.service.find(COMPLEX_ID, user)).rejects.toThrow(
      'No tienes una unidad activa',
    );
  });

  it('trae vehículos, bodegas e integrantes de SU unidad', async () => {
    const h = build(me, [me]);
    const result = await h.service.find(COMPLEX_ID, user);

    expect(h.assetService.listForUnit).toHaveBeenCalledWith('unit-1');
    const [{ where: vehicleWhere }] = h.vehicleRepo.find.mock.calls[0] as [
      { where: { unitId: string; status: { value: string[] } } },
    ];
    expect(vehicleWhere.unitId).toBe('unit-1');
    // Not(In([...])): los rechazados y retirados no se muestran.
    expect(vehicleWhere.status.value).toEqual([
      VehicleStatus.REJECTED,
      VehicleStatus.REMOVED,
    ]);
    const [{ where: memberWhere }] = h.residentRepo.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(memberWhere).toMatchObject({
      unitId: 'unit-1',
      status: ResidentStatus.ACTIVE,
    });
    expect(result.assets).toHaveLength(1);
    expect(result.vehicles).toHaveLength(1);
    expect(result.nextRotationAt).toEqual(new Date('2026-11-01T11:00:00.000Z'));
  });

  it('marca a quien consulta y pone primero al principal', async () => {
    const main = resident({
      id: 'res-main',
      type: ResidentType.OWNER,
      isMainResident: true,
      startDate: new Date('2026-01-01'),
    });
    const h = build(me, [me, main]);
    const { members } = await h.service.find(COMPLEX_ID, user);

    expect(members.map((m) => m.residentId)).toEqual(['res-main', 'res-me']);
    expect(members.find((m) => m.residentId === 'res-me')?.isMe).toBe(true);
    expect(members.find((m) => m.residentId === 'res-main')?.isMe).toBe(false);
    // Solo lo necesario entre quienes viven juntos.
    expect(Object.keys(members[0]).sort()).toEqual(
      [
        'isMainResident',
        'isMe',
        'lastName',
        'name',
        'phoneNumber',
        'residentId',
        'startDate',
        'type',
      ].sort(),
    );
  });
});
