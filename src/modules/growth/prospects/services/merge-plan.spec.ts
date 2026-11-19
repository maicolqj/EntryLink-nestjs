import {
  GrowthMergeSide as Side,
  GrowthProspectKind as K,
  GrowthValidationStatus as V,
} from '../prospects.enums';
import { movesFor, needsRevalidation, planMergeFields } from './merge.service';

describe('planMergeFields (fusión y vista previa)', () => {
  const survivor = {
    legalName: 'Andes SAS',
    nit: null,
    address: 'Calle 1',
    city: 'Bogotá',
  };
  const merged = {
    legalName: 'Andes PH',
    nit: '900',
    address: 'Calle 1',
    city: '',
  };

  it('clasifica cada campo combinable y lista los conflictos sin elegir', () => {
    const plan = planMergeFields(K.ORGANIZATION, survivor, merged, []);
    const by = Object.fromEntries(plan.fields.map((f) => [f.field, f.outcome]));
    expect(by.legalName).toBe('CONFLICT');
    expect(by.nit).toBe('FROM_MERGED');
    expect(by.address).toBe('SAME');
    expect(by.city).toBe('SURVIVOR_ONLY');
    expect(plan.missing).toEqual(['legalName']);
    expect(plan.fieldChoices).toEqual({ nit: 'MERGED_AUTO' });
    expect(plan.fromMerged).toEqual(['nit']);
  });

  it('aplica la elección y calcula el valor resultante', () => {
    const plan = planMergeFields(K.ORGANIZATION, survivor, merged, [
      { field: 'legalName', side: Side.MERGED },
    ]);
    const legal = plan.fields.find((f) => f.field === 'legalName')!;
    expect(legal.chosenSide).toBe(Side.MERGED);
    expect(legal.resultValue).toBe('Andes PH');
    expect(plan.missing).toEqual([]);
    expect(plan.fieldChoices).toEqual({
      nit: 'MERGED_AUTO',
      legalName: 'MERGED',
    });
  });

  it('rechaza campos que no se combinan', () => {
    expect(() =>
      planMergeFields(K.PERSON, {}, {}, [
        { field: 'legalBasis', side: Side.MERGED },
      ]),
    ).toThrow(/no se combina/);
  });
});

describe('needsRevalidation', () => {
  it('solo un VALIDATED con cambio en un campo crítico vuelve a revisión', () => {
    expect(
      needsRevalidation(
        K.ORGANIZATION,
        V.VALIDATED,
        { nit: '1' },
        { nit: '2' },
      ),
    ).toBe(true);
    expect(
      needsRevalidation(
        K.ORGANIZATION,
        V.VALIDATED,
        { city: 'a' },
        { city: 'b' },
      ),
    ).toBe(false);
    expect(
      needsRevalidation(K.ORGANIZATION, V.NEW, { nit: '1' }, { nit: '2' }),
    ).toBe(false);
  });
});

describe('movesFor', () => {
  it('cubre asignaciones y evidencias en todos los tipos, y las relaciones de cada uno', () => {
    expect(movesFor(K.ORGANIZATION).map((m) => m.key)).toEqual([
      'assignments',
      'evidences',
      'channels',
      'employments',
      'managements',
    ]);
    expect(movesFor(K.PERSON).map((m) => m.key)).toContain('responsibleOf');
    expect(movesFor(K.PROPERTY).map((m) => m.key)).toEqual([
      'assignments',
      'evidences',
      'managements',
    ]);
  });
});
