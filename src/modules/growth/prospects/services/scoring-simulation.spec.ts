import { ScoringRule } from '../entities/dedupe-scoring.entity';
import {
  GrowthInterestSignal,
  GrowthPriority,
  GrowthProspectKind as K,
  GrowthScoreBasis as B,
  GrowthScoringPredicate as Pred,
} from '../prospects.enums';
import { ProspectFacts } from '../shared/scoring-rules';
import { applyChanges } from './scoring-simulation.service';
import { computeScore, priorityFor } from './scoring.service';

const rule = (over: Partial<ScoringRule>): ScoringRule =>
  ({
    id: over.key ?? 'r',
    key: 'R',
    label: 'Regla',
    predicate: Pred.VERIFIED_CHANNEL,
    params: {},
    points: 10,
    appliesTo: [K.ORGANIZATION, K.PERSON],
    active: true,
    sortOrder: 10,
    ...over,
  }) as ScoringRule;

const RULES = [
  rule({
    id: 'r1',
    key: 'PROPS',
    predicate: Pred.PROPERTIES_GTE,
    params: { min: 2 },
    points: 30,
    sortOrder: 1,
  }),
  rule({ id: 'r2', key: 'CHANNEL', points: 20, sortOrder: 2 }),
  rule({
    id: 'r3',
    key: 'INTEREST',
    predicate: Pred.INTEREST_SIGNAL_IN,
    params: { values: ['DEMO_REQUESTED'] },
    points: 60,
    sortOrder: 3,
    active: false,
  }),
];

const FACTS: ProspectFacts = {
  properties: { value: 3, basis: B.ESTIMATED },
  units: { value: 0, basis: B.ESTIMATED },
  verifiedChannel: true,
  interestSignal: {
    value: GrowthInterestSignal.DEMO_REQUESTED,
    basis: B.VERIFIED,
  },
};

describe('computeScore (motor único del scoring)', () => {
  it('suma solo reglas activas que aplican al tipo, en su orden', () => {
    const r = computeScore(
      RULES,
      { high: 60, medium: 30 },
      K.ORGANIZATION,
      FACTS,
    );
    expect(r.breakdown.map((b) => b.ruleKey)).toEqual(['PROPS', 'CHANNEL']);
    expect(r.score).toBe(50);
    expect(r.priority).toBe(GrowthPriority.MEDIUM);
    expect(r.hasEstimates).toBe(true);
  });

  it('acota a 0–100 y respeta appliesTo', () => {
    const big = [
      rule({ id: 'a', key: 'A', points: 80 }),
      rule({ id: 'b', key: 'B', points: 80 }),
      rule({ id: 'c', key: 'C', points: -100, appliesTo: [K.PERSON] }),
    ];
    expect(
      computeScore(big, { high: 60, medium: 30 }, K.ORGANIZATION, FACTS).score,
    ).toBe(100);
    expect(
      computeScore(big, { high: 60, medium: 30 }, K.PERSON, FACTS).score,
    ).toBe(60);
  });

  it('priorityFor usa los umbrales inclusivos', () => {
    const t = { high: 60, medium: 30 };
    expect(priorityFor(60, t)).toBe(GrowthPriority.HIGH);
    expect(priorityFor(30, t)).toBe(GrowthPriority.MEDIUM);
    expect(priorityFor(29, t)).toBe(GrowthPriority.LOW);
  });
});

describe('applyChanges (simulación en memoria)', () => {
  it('modifica, activa y agrega reglas sin tocar las originales', () => {
    const proposed = applyChanges(RULES, [
      { ruleId: 'r1', points: 10 },
      { ruleId: 'r3', active: true },
      {
        key: 'UNITS',
        label: 'Muchas unidades',
        predicate: Pred.UNITS_GT,
        params: { value: 100 },
        points: 15,
        appliesTo: [K.ORGANIZATION],
      },
    ]);
    expect(RULES[0].points).toBe(30);
    expect(RULES[2].active).toBe(false);
    const r = computeScore(
      proposed,
      { high: 60, medium: 30 },
      K.ORGANIZATION,
      FACTS,
    );
    expect(r.breakdown.map((b) => b.ruleKey)).toEqual([
      'PROPS',
      'CHANNEL',
      'INTEREST',
    ]);
    expect(r.score).toBe(90);
    expect(proposed.find((p) => p.key === 'UNITS')?.active).toBe(true);
  });

  it('rechaza lo mismo que guardar: parámetros inválidos, clave repetida o cambiada, regla inexistente', () => {
    expect(() =>
      applyChanges(RULES, [{ ruleId: 'r1', params: { min: -1 } }]),
    ).toThrow(/Parámetros inválidos/);
    expect(() => applyChanges(RULES, [{ ruleId: 'r1', key: 'OTRA' }])).toThrow(
      /no se cambia/,
    );
    expect(() => applyChanges(RULES, [{ ruleId: 'nope' }])).toThrow(
      /no encontrada/,
    );
    expect(() =>
      applyChanges(RULES, [
        {
          key: 'CHANNEL',
          label: 'x',
          predicate: Pred.VERIFIED_CHANNEL,
          points: 1,
          appliesTo: [K.PERSON],
        },
      ]),
    ).toThrow(/Ya existe/);
    expect(() =>
      applyChanges(RULES, [{ key: 'NUEVA', label: 'Sin puntos' }]),
    ).toThrow(/exige/);
    expect(() =>
      applyChanges(RULES, [
        { ruleId: 'r1', points: 1 },
        { ruleId: 'r1', points: 2 },
      ]),
    ).toThrow(/una sola vez/);
  });
});
