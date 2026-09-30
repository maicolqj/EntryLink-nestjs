import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';

/**
 * QR de primer ingreso de la cuenta del complejo.
 *
 * El token se marcaba como usado ANTES de validar el resto: un complejo que se
 * registró solo (sin owner) fallaba al crear la sesión y el QR quedaba quemado;
 * el siguiente intento decía "ya fue utilizado" sin haber entrado nunca.
 */
const TOKEN = 'qr-token';
const PIN = '4321';

const build = async (overrides: Record<string, unknown> = {}) => {
  const complex = {
    id: 'complex-1',
    status: ComplexStatus.PENDING_REVIEW,
    qrLoginToken: TOKEN,
    qrLoginTokenUsed: false,
    qrLoginTokenExp: new Date(Date.now() + 60_000),
    qrLoginPin: await bcrypt.hash(PIN, 4),
    ownerId: 'super-1',
    owner: { id: 'super-1' },
    nit: '900123-4',
    ...overrides,
  };

  const qb: Record<string, jest.Mock> = {};
  for (const m of ['addSelect', 'leftJoinAndSelect', 'where', 'andWhere']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getOne = jest.fn(async () => complex);

  const complexRepo = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(async () => complex),
    update: jest.fn(async (..._args: unknown[]) => ({ affected: 1 })),
  };

  const service = Object.create(AuthService.prototype) as AuthService;
  const session = { accessToken: 'at', refreshToken: 'rt' };
  const createComplexSession = jest.fn(async () => session);
  Object.assign(service, {
    complexRepo,
    logger: { log: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    createComplexSession,
  });
  return { service, complexRepo, createComplexSession, session };
};

const usedMarks = (update: jest.Mock<any, any[]>) =>
  update.mock.calls.filter(([, data]) => data?.qrLoginTokenUsed === true);

describe('AuthService — QR de primer ingreso', () => {
  it('canjea y marca el token como usado solo tras validar todo', async () => {
    const h = await build();

    await expect(
      h.service.redeemQrToken(TOKEN, PIN, {} as never),
    ).resolves.toBe(h.session);

    const marks = usedMarks(h.complexRepo.update);
    expect(marks).toHaveLength(1);
    // El marcado es condicional: dos canjes a la vez no entran los dos.
    expect(marks[0][0]).toEqual({
      id: 'complex-1',
      qrLoginToken: TOKEN,
      qrLoginTokenUsed: false,
    });
  });

  it('un complejo sin owner no quema el token', async () => {
    const h = await build({ ownerId: null, owner: null });

    await expect(
      h.service.redeemQrToken(TOKEN, PIN, {} as never),
    ).rejects.toThrow('propietario');
    expect(usedMarks(h.complexRepo.update)).toHaveLength(0);
  });

  it('un PIN incorrecto no quema el token', async () => {
    const h = await build();

    await expect(
      h.service.redeemQrToken(TOKEN, '0000', {} as never),
    ).rejects.toThrow('PIN incorrecto');
    expect(usedMarks(h.complexRepo.update)).toHaveLength(0);
  });

  it('si la sesión no se crea, el QR vuelve a quedar disponible', async () => {
    const h = await build();
    h.createComplexSession.mockRejectedValueOnce(new Error('db'));

    await expect(
      h.service.redeemQrToken(TOKEN, PIN, {} as never),
    ).rejects.toThrow('db');
    expect(h.complexRepo.update).toHaveBeenLastCalledWith('complex-1', {
      qrLoginTokenUsed: false,
    });
  });

  it('si otro canje ganó la carrera, responde "ya fue utilizado"', async () => {
    const h = await build();
    h.complexRepo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(
      h.service.redeemQrToken(TOKEN, PIN, {} as never),
    ).rejects.toThrow('ya fue utilizado');
    expect(h.createComplexSession).not.toHaveBeenCalled();
  });

  it('al generar el QR, un complejo sin owner queda con quien lo generó', async () => {
    const h = await build({ ownerId: null, owner: null });

    await h.service.generateQrLoginToken('complex-1', 'super-1');

    expect(h.complexRepo.update).toHaveBeenCalledWith(
      'complex-1',
      expect.objectContaining({ ownerId: 'super-1', qrLoginTokenUsed: false }),
    );
  });

  it('al generar el QR, no cambia el owner que ya existe', async () => {
    const h = await build({ ownerId: 'otro-admin' });

    await h.service.generateQrLoginToken('complex-1', 'super-1');

    const data = h.complexRepo.update.mock.calls[0][1];
    expect(data).not.toHaveProperty('ownerId');
  });
});
