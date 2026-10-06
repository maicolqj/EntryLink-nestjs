import { ResidentialComplexService } from './residential-complex.service';
import { ComplexStatus } from '../enums/complex-status.enum';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';

/**
 * Suspender un complejo exige motivo, corta en vivo a la administración (socket
 * + caché del guard) y reactivarlo borra el motivo.
 */
const build = (complex: Record<string, unknown>) => {
  const service = Object.create(
    ResidentialComplexService.prototype,
  ) as ResidentialComplexService;
  const manager = {
    save: jest.fn((_entity: unknown, value: unknown) => Promise.resolve(value)),
    update: jest.fn(),
  };
  const cache = { delete: jest.fn() };
  const socket = { emitToComplex: jest.fn() };
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn() },
    findById: jest.fn(() => Promise.resolve({ id: 'c1', ...complex })),
    dataSource: {
      transaction: jest.fn((fn: (m: unknown) => unknown) =>
        Promise.resolve(fn(manager)),
      ),
    },
    cacheService: cache,
    socketService: socket,
    auditService: { log: jest.fn() },
    restoreDisabledUnits: jest.fn(),
    seedPucSafe: jest.fn(),
  });
  return { service, manager, cache, socket };
};

const superAdmin = {
  sub: 'admin',
  email: 'admin@alternaqj.com',
  roles: ['SUPER_ADMIN_ROL'],
} as never;

describe('ResidentialComplexService.changeStatus (suspensión)', () => {
  it('no deja suspender sin motivo', async () => {
    const { service, manager } = build({ status: ComplexStatus.ACTIVE });

    await expect(
      service.changeStatus('c1', ComplexStatus.SUSPENDED, superAdmin, '   '),
    ).rejects.toMatchObject({
      errorCode: 'COMPLEX_SUSPENSION_REASON_REQUIRED',
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('guarda el motivo, borra la caché del guard y avisa por socket', async () => {
    const { service, cache, socket } = build({ status: ComplexStatus.ACTIVE });

    const saved = await service.changeStatus(
      'c1',
      ComplexStatus.SUSPENDED,
      superAdmin,
      '  Cuotas de la plataforma en mora  ',
    );

    expect(saved.suspensionReason).toBe('Cuotas de la plataforma en mora');
    expect(saved.suspendedAt).toBeInstanceOf(Date);
    expect(cache.delete).toHaveBeenCalledWith({
      key: { prefix: 'cpxsub', key: 'c1' },
    });
    expect(socket.emitToComplex).toHaveBeenCalledWith(
      'c1',
      SocketEvent.COMPLEX_STATUS_CHANGED,
      expect.objectContaining({
        status: ComplexStatus.SUSPENDED,
        reason: 'Cuotas de la plataforma en mora',
      }),
    );
  });

  it('reactivar borra el motivo y avisa para sacar a la web de la pantalla', async () => {
    const { service, socket } = build({
      status: ComplexStatus.SUSPENDED,
      suspensionReason: 'mora',
      suspendedAt: new Date(),
    });

    const saved = await service.changeStatus(
      'c1',
      ComplexStatus.ACTIVE,
      superAdmin,
    );

    expect(saved.suspensionReason).toBeNull();
    expect(saved.suspendedAt).toBeNull();
    expect(socket.emitToComplex).toHaveBeenCalledWith(
      'c1',
      SocketEvent.COMPLEX_STATUS_CHANGED,
      expect.objectContaining({ status: ComplexStatus.ACTIVE, reason: null }),
    );
  });

  it('cambiar solo el motivo de una suspensión vigente conserva la fecha', async () => {
    const since = new Date('2026-10-01T12:00:00Z');
    const { service } = build({
      status: ComplexStatus.SUSPENDED,
      suspensionReason: 'mora',
      suspendedAt: since,
    });

    const saved = await service.changeStatus(
      'c1',
      ComplexStatus.SUSPENDED,
      superAdmin,
      'Mora de tres meses',
    );

    expect(saved.suspendedAt).toBe(since);
    expect(saved.suspensionReason).toBe('Mora de tres meses');
  });
});
