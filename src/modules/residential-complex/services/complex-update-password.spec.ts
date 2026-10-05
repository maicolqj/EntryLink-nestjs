import * as bcrypt from 'bcrypt';

import { ResidentialComplexService } from './residential-complex.service';
import { UpdateComplexInput } from '../dto/inputs/update-complex.input';

/**
 * Editar el complejo solo toca lo que se envía, y la contraseña, si llega, se
 * guarda hasheada: nunca en texto plano ni en la auditoría.
 */
const build = (stored: Record<string, unknown>) => {
  const service = Object.create(
    ResidentialComplexService.prototype,
  ) as ResidentialComplexService;
  const save = jest.fn(async (complex) => complex);
  const log = jest.fn();
  Object.assign(service, {
    logger: { log: jest.fn() },
    complexRepo: { save, findOne: jest.fn(async () => stored) },
    cacheService: { delete: jest.fn() },
    auditService: { log },
    geocodingService: { geocodeAddress: jest.fn() },
  });
  jest.spyOn(service, 'findById').mockResolvedValue({ ...stored } as never);
  return { service, save, log };
};

const input = (fields: Partial<UpdateComplexInput>) =>
  Object.assign(new UpdateComplexInput(), fields);

const currentUser = {
  sub: 'admin',
  email: 'a@b.co',
  roles: ['SUPER_ADMIN_ROL'],
};

describe('ResidentialComplexService.update — contraseña y campos parciales', () => {
  it('hashea la contraseña y no la deja en la auditoría', async () => {
    const { service, save, log } = build({ id: 'c1', name: 'Torres' });

    await service.update(
      input({ id: 'c1', password: 'Nueva.Clave1' }),
      currentUser as never,
    );

    const saved = save.mock.calls[0][0];
    expect(saved.password).not.toBe('Nueva.Clave1');
    await expect(bcrypt.compare('Nueva.Clave1', saved.password)).resolves.toBe(
      true,
    );
    expect(saved.passwordSet).toBe(true);
    expect(saved.lastPasswordChange).toBeInstanceOf(Date);

    const audit = log.mock.calls[0][0].newValue;
    expect(audit.password).toBeUndefined();
    expect(audit.passwordChanged).toBe(true);
  });

  it('sin contraseña no toca la guardada ni los campos no enviados', async () => {
    const { service, save } = build({
      id: 'c1',
      name: 'Torres',
      email: 'conjunto@x.co',
      password: '$2b$10$hashguardado',
    });

    await service.update(
      input({ id: 'c1', name: 'Torres del Sol' }),
      currentUser as never,
    );

    const saved = save.mock.calls[0][0];
    expect(saved.name).toBe('Torres del Sol');
    expect(saved.email).toBe('conjunto@x.co');
    expect(saved.password).toBe('$2b$10$hashguardado');
  });
});
