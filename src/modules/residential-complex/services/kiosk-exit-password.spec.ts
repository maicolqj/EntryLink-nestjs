import * as bcrypt from 'bcrypt';

import { ResidentialComplexService } from './residential-complex.service';

/**
 * Portería solo sale del modo kiosco con la contraseña del conjunto, y los
 * intentos fallidos tienen tope para que no se pueda adivinar desde el equipo.
 */
const build = async (opts: { password?: string | null; attempts?: number }) => {
  const service = Object.create(
    ResidentialComplexService.prototype,
  ) as ResidentialComplexService;
  const hash =
    opts.password === null ? null : await bcrypt.hash(opts.password ?? 'Clave.Conjunto1', 4);
  const qb = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => ({ id: 'c1', password: hash })),
  };
  const cache = {
    get: jest.fn(async () =>
      opts.attempts ? { count: opts.attempts } : null,
    ),
    set: jest.fn(),
    delete: jest.fn(),
  };
  Object.assign(service, {
    logger: { log: jest.fn() },
    complexRepo: { createQueryBuilder: jest.fn(() => qb) },
    cacheService: cache,
  });
  return { service, cache, qb };
};

const guard = { sub: 'guarda-1', complexId: 'c1', roles: ['SECURITY_ROL'] } as never;

describe('ResidentialComplexService.verifyKioskExitPassword', () => {
  it('autoriza con la contraseña del conjunto y limpia los intentos', async () => {
    const { service, cache, qb } = await build({});
    await expect(
      service.verifyKioskExitPassword('Clave.Conjunto1', guard),
    ).resolves.toBe(true);
    expect(qb.where).toHaveBeenCalledWith('complex.id = :id', { id: 'c1' });
    expect(cache.delete).toHaveBeenCalled();
  });

  it('rechaza una contraseña equivocada y cuenta el intento', async () => {
    const { service, cache } = await build({ attempts: 2 });
    await expect(
      service.verifyKioskExitPassword('otra', guard),
    ).rejects.toMatchObject({ errorCode: 'COMPLEX_PASSWORD_INVALID' });
    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: { count: 3 } }),
    );
  });

  it('bloquea tras 5 intentos fallidos, aun con la contraseña correcta', async () => {
    const { service } = await build({ attempts: 5 });
    await expect(
      service.verifyKioskExitPassword('Clave.Conjunto1', guard),
    ).rejects.toMatchObject({ errorCode: 'COMPLEX_PASSWORD_TOO_MANY_ATTEMPTS' });
  });

  it('avisa si el conjunto no tiene contraseña', async () => {
    const { service } = await build({ password: null });
    await expect(
      service.verifyKioskExitPassword('x', guard),
    ).rejects.toMatchObject({ errorCode: 'COMPLEX_PASSWORD_NOT_SET' });
  });
});
