import { MyUnitService } from './my-unit.service';
import { ResidentType } from '../residents/enums/resident-type.enum';
import { ResidentStatus } from '../residents/enums/resident-status.enum';
import { VehicleStatus } from '../vehicles/enums/vehicle-status.enum';

/**
 * "Mi unidad": la unidad sale de la ficha activa de quien pregunta, nunca de un
 * id que mande la app, y los integrantes son solo los de esa unidad.
 */

const COMPLEX_ID = 'complex-1';

/**
 * Reloj fijo. El servicio calcula la próxima rotación contra `new Date()`
 * (effectiveNextRotation): con una fecha guardada fija y el reloj real, la
 * prueba pasaba hasta las 6 a. m. del 1 de noviembre de 2026 y fallaba desde
 * entonces. Solo se simula `Date`; los temporizadores y las promesas siguen
 * siendo reales.
 */
const NOW = new Date('2026-10-31T15:00:00.000Z'); // 10 a. m. de Bogotá
/** Próxima rotación guardada: mañana a las 6 a. m. de Bogotá. */
const STORED_NEXT = new Date('2026-11-01T11:00:00.000Z');

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
});

afterEach(() => {
  jest.useRealTimers();
});
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

const build = (
  me: unknown,
  household: unknown[] = [],
  nextExecutionAt: Date | null = STORED_NEXT,
) => {
  const residentRepo = {
    findOne: jest.fn().mockResolvedValue(me),
    find: jest.fn().mockResolvedValue(household),
  };
  const vehicleRepo = { find: jest.fn().mockResolvedValue([{ id: 'veh-1' }]) };
  const rotationRepo = {
    findOne: jest.fn().mockResolvedValue({ nextExecutionAt }),
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
    expect(result.nextRotationAt).toEqual(STORED_NEXT);
  });

  it('si la fecha guardada ya pasó, muestra la siguiente pasada del cron (6 a. m. de Bogotá)', async () => {
    // Guardada ayer: el cron no corrió. A las 10 a. m. ya pasó la de hoy,
    // así que la próxima es mañana a las 6 a. m.
    const h = build(me, [me], new Date('2026-10-30T11:00:00.000Z'));
    const result = await h.service.find(COMPLEX_ID, user);
    expect(result.nextRotationAt).toEqual(STORED_NEXT);
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
