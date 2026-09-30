import { UnitAssetService } from './unit-asset.service';
import { UnitAsset } from '../entities/unit-asset.entity';
import { UnitAssetType } from '../enums/unit-asset-type.enum';

/**
 * Una bodega o un parqueadero es de una sola unidad del conjunto, y el código
 * se compara normalizado: "s1 - 14" y "S1-14" son la misma bodega.
 */

const user = { sub: 'admin', roles: ['COMPLEX_ROL'] } as never;

const build = (taken: unknown = null) => {
  const assetRepo = {
    create: jest.fn((data: Partial<UnitAsset>) =>
      Object.assign(new UnitAsset(), data),
    ),
    findOne: jest.fn().mockResolvedValue(taken),
    save: jest.fn((a: UnitAsset) => Promise.resolve(a)),
  };
  const unitService = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'unit-1', complexId: 'complex-1' }),
  };
  const service = new UnitAssetService(
    assetRepo as never,
    unitService as never,
  );
  return { service, assetRepo, unitService };
};

describe('UnitAssetService', () => {
  it('normaliza el código y lo guarda en la unidad y su conjunto', async () => {
    const h = build();
    const saved = await h.service.create(
      {
        unitId: 'unit-1',
        type: UnitAssetType.STORAGE,
        code: ' s1 - 14 ',
        location: '  Sótano 1  ',
      },
      user,
    );

    expect(h.unitService.findById).toHaveBeenCalledWith('unit-1', user);
    expect(saved.code).toBe('S1-14');
    expect(saved.location).toBe('Sótano 1');
    expect(saved.complexId).toBe('complex-1');
  });

  it('rechaza un código que ya es de otra unidad y dice cuál', async () => {
    const h = build({ id: 'otro', unit: { number: '301' } });

    await expect(
      h.service.create(
        { unitId: 'unit-1', type: UnitAssetType.PARKING, code: 'P-10' },
        user,
      ),
    ).rejects.toThrow('ya está asignado a la unidad 301');
    expect(h.assetRepo.save).not.toHaveBeenCalled();
  });
});
