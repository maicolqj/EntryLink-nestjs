import { ResidentialComplexService } from './residential-complex.service';
import { CustomError } from '../../shared/utils/errors.utils';

/**
 * El plan limita cuántas unidades se pueden crear, salvo que el conjunto pague
 * por unidad: ahí cada unidad nueva sube lo que paga y no hay tope.
 */
const build = (complex: Record<string, unknown>) => {
  const service = Object.create(
    ResidentialComplexService.prototype,
  ) as ResidentialComplexService;
  Object.assign(service, {
    complexRepo: { findOne: jest.fn(async () => complex) },
  });
  return service;
};

describe('ResidentialComplexService — límite de unidades', () => {
  it('por plan: bloquea al llegar al límite', async () => {
    const service = build({
      id: 'c1',
      plan: 'PRO',
      maxUnits: 200,
      subscriptionPricingMode: 'PLAN',
    });

    await expect(service.assertUnitsLimit('c1', 200)).rejects.toBeInstanceOf(
      CustomError,
    );
  });

  it('valor fijo: también respeta el límite del plan', async () => {
    const service = build({
      id: 'c1',
      plan: 'BASIC',
      maxUnits: 50,
      subscriptionPricingMode: 'FIXED',
    });

    await expect(service.assertUnitsLimit('c1', 50)).rejects.toBeInstanceOf(
      CustomError,
    );
  });

  it('por unidad: no hay tope aunque el plan sea pequeño', async () => {
    const service = build({
      id: 'c1',
      plan: 'BASIC',
      maxUnits: 50,
      subscriptionPricingMode: 'PER_UNIT',
    });

    await expect(service.assertUnitsLimit('c1', 800)).resolves.toBeUndefined();
  });
  it('piloto: el tope son las unidades declaradas, no las 10 de FREE', async () => {
    const service = build({
      id: 'c1',
      plan: 'FREE',
      maxUnits: 10,
      subscriptionPricingMode: 'PLAN',
      engagement: 'PILOT',
      totalUnits: 140,
    });

    await expect(service.assertUnitsLimit('c1', 139)).resolves.toBeUndefined();
    await expect(service.assertUnitsLimit('c1', 140)).rejects.toBeInstanceOf(
      CustomError,
    );
  });

  it('piloto sin unidades declaradas: vuelve al límite del plan', async () => {
    const service = build({
      id: 'c1',
      plan: 'FREE',
      maxUnits: 10,
      subscriptionPricingMode: 'PLAN',
      engagement: 'PILOT',
      totalUnits: null,
    });

    await expect(service.assertUnitsLimit('c1', 10)).rejects.toBeInstanceOf(
      CustomError,
    );
  });
});
