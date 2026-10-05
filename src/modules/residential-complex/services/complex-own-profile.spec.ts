import { ResidentialComplexService } from './residential-complex.service';
import { UpdateComplexInput } from '../dto/inputs/update-complex.input';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * La cuenta del complejo solo cambia su teléfono y su sitio web
 * (updateOwnProfile) y sus ajustes de operación en updateComplex. Nombre, NIT,
 * dirección, plan, correo… los corrige el SUPER_ADMIN.
 */
const build = (stored: Record<string, unknown>) => {
  const service = Object.create(
    ResidentialComplexService.prototype,
  ) as ResidentialComplexService;
  const save = jest.fn(async (complex) => complex);
  Object.assign(service, {
    logger: { log: jest.fn() },
    complexRepo: { save, findOne: jest.fn(async () => stored) },
    cacheService: { delete: jest.fn() },
    auditService: { log: jest.fn() },
    geocodingService: { geocodeAddress: jest.fn() },
  });
  jest.spyOn(service, 'findById').mockResolvedValue({ ...stored } as never);
  return { service, save };
};

const complexAccount = {
  sub: 'c1',
  complexId: 'c1',
  email: 'conjunto@x.co',
  roles: ['COMPLEX_ROL'],
};

const input = (fields: Partial<UpdateComplexInput>) =>
  Object.assign(new UpdateComplexInput(), fields);

describe('updateOwnProfile', () => {
  it('cambia teléfono y sitio web del conjunto de la sesión', async () => {
    const { service, save } = build({
      id: 'c1',
      phoneNumber: '1',
      website: null,
    });

    await service.updateOwnProfile(
      { phoneNumber: ' +57 300 123 4567 ', website: 'www.torres.co' },
      complexAccount as never,
    );

    expect(service.findById).toHaveBeenCalledWith('c1', complexAccount);
    const saved = save.mock.calls[0][0];
    expect(saved.phoneNumber).toBe('+57 300 123 4567');
    expect(saved.website).toBe('www.torres.co');
  });

  it('cadena vacía quita el dato; lo que no llega no se toca', async () => {
    const { service, save } = build({
      id: 'c1',
      phoneNumber: '300',
      website: 'www.torres.co',
    });

    await service.updateOwnProfile({ website: '' }, complexAccount as never);

    const saved = save.mock.calls[0][0];
    expect(saved.website).toBeNull();
    expect(saved.phoneNumber).toBe('300');
  });
});

describe('updateComplex desde la cuenta del complejo', () => {
  it.each([
    ['dirección', { address: 'Otra 123' }],
    ['ciudad', { city: 'Cali' }],
    ['nombre', { name: 'Otro nombre' }],
    ['plan', { plan: 'PREMIUM' }],
    ['correo', { email: 'otro@x.co' }],
  ])('rechaza cambiar %s', async (_label, fields) => {
    const { service, save } = build({ id: 'c1' });

    await expect(
      service.update(
        input({ id: 'c1', ...(fields as object) }),
        complexAccount as never,
      ),
    ).rejects.toMatchObject({
      errorCode: ComplexErrorCode.COMPLEX_FIELD_CHANGE_FORBIDDEN,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('permite sus ajustes de PQRF', async () => {
    const { service, save } = build({ id: 'c1', pqrfResolutionDays: 15 });

    await service.update(
      input({ id: 'c1', pqrfResolutionDays: 10, pqrfReminderLeadDays: 2 }),
      complexAccount as never,
    );

    expect(save.mock.calls[0][0].pqrfResolutionDays).toBe(10);
  });
});
