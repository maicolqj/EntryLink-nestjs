import {
  GrowthInterestSignal,
  GrowthScoreBasis as B,
  GrowthScoringPredicate as Pred,
} from '../prospects.enums';
import { SEED_SCORING_RULES } from '../../../../core/database/migrations/1781010800000-CreateGrowthDedupeAndScoring';
import {
  evaluateRule,
  ProspectFacts,
  validateRuleParams,
} from './scoring-rules';
import { nameSimilarity } from './similarity';

const facts = (over: Partial<ProspectFacts> = {}): ProspectFacts => ({
  properties: { value: 0, basis: B.ESTIMATED },
  units: { value: 0, basis: B.ESTIMATED },
  verifiedChannel: false,
  interestSignal: { value: GrowthInterestSignal.NONE, basis: B.ESTIMATED },
  ...over,
});

const score = (f: ProspectFacts) =>
  SEED_SCORING_RULES.reduce((acc, r) => {
    const hit = evaluateRule(
      { predicate: r.predicate as Pred, params: r.params },
      f,
    );
    return acc + (hit ? r.points : 0);
  }, 0);

describe('similitud de nombres', () => {
  it('nombres iguales o casi iguales puntúan alto; distintos, bajo', () => {
    expect(
      nameSimilarity('administraciones andes', 'administraciones andes'),
    ).toBe(1);
    expect(
      nameSimilarity('administraciones andes', 'administracion andes'),
    ).toBeGreaterThan(0.7);
    expect(nameSimilarity('los pinos', 'el bosque')).toBeLessThan(0.3);
    expect(nameSimilarity('', 'algo')).toBe(0);
  });
});

describe('reglas de scoring aprobadas', () => {
  it('las reglas sembradas tienen parámetros válidos', () => {
    for (const r of SEED_SCORING_RULES) {
      expect(
        validateRuleParams({
          predicate: r.predicate as Pred,
          params: r.params,
        }),
      ).toBeNull();
    }
  });

  it.each([
    [12, 40],
    [10, 40],
    [9, 30],
    [5, 30],
    [4, 20],
    [2, 20],
    [1, 0],
  ])('%p copropiedades → %p puntos', (n, pts) => {
    expect(score(facts({ properties: { value: n, basis: B.VERIFIED } }))).toBe(
      pts,
    );
  });

  it('suma: 10+ copropiedades, >500 unidades, canal verificado e interés = 90', () => {
    expect(
      score(
        facts({
          properties: { value: 11, basis: B.VERIFIED },
          units: { value: 650, basis: B.ESTIMATED },
          verifiedChannel: true,
          interestSignal: {
            value: GrowthInterestSignal.DEMO_REQUESTED,
            basis: B.VERIFIED,
          },
        }),
      ),
    ).toBe(90);
  });

  it('exactamente 500 unidades no suma (> 500)', () => {
    expect(score(facts({ units: { value: 500, basis: B.VERIFIED } }))).toBe(0);
  });

  it('la base de cada regla viaja al desglose (estimado vs verificado)', () => {
    const hit = evaluateRule(
      { predicate: Pred.UNITS_GT, params: { value: 500 } },
      facts({ units: { value: 800, basis: B.ESTIMATED } }),
    );
    expect(hit).toEqual({ basis: B.ESTIMATED, value: '800' });
  });

  it.each([
    [Pred.PROPERTIES_GTE, { min: -1 }],
    [Pred.PROPERTIES_GTE, { min: 3, extra: 1 }],
    [Pred.PROPERTIES_BETWEEN, { min: 9, max: 5 }],
    [Pred.UNITS_GT, { value: 'mucho' }],
    [Pred.VERIFIED_CHANNEL, { x: 1 }],
    [Pred.INTEREST_SIGNAL_IN, { values: ['QUIZAS'] }],
    [Pred.INTEREST_SIGNAL_IN, { values: [] }],
  ])('parámetros inválidos se rechazan: %p %p', (predicate, params) => {
    expect(validateRuleParams({ predicate, params })).not.toBeNull();
  });
});
