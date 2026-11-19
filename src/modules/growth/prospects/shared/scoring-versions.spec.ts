import { SEED_SCORING_RULES } from '../../../../core/database/migrations/1781010800000-CreateGrowthDedupeAndScoring';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { ScoringVersionRule } from '../entities/scoring-version.entity';
import {
  GrowthPriority,
  GrowthProspectKind as K,
  GrowthScoreBasis,
  GrowthScoringPredicate,
} from '../prospects.enums';
import {
  approvalDecision,
  scoreChanged,
  scoringVersionProblems,
} from './scoring-versions';

const actor = (sub: string, roles: ValidRoles[] = []) =>
  ({ sub, roles, permissions: [] }) as unknown as JwtAccessPayload;

/** Las reglas sembradas, en la forma de una versión. */
const seeded = (): ScoringVersionRule[] =>
  SEED_SCORING_RULES.map((r, i) => ({
    key: r.key,
    label: r.label,
    predicate: r.predicate as GrowthScoringPredicate,
    params: r.params,
    points: r.points,
    appliesTo: r.appliesTo as K[],
    active: true,
    sortOrder: (i + 1) * 10,
  }));
const thresholds = { high: 50, medium: 25 };

describe('Versiones de scoring: validación del borrador', () => {
  it('las reglas sembradas con los umbrales actuales son una versión válida', () => {
    expect(scoringVersionProblems(seeded(), thresholds)).toEqual([]);
  });

  it('rechaza umbrales fuera de rango o con el medio mayor o igual al alto', () => {
    for (const t of [
      { high: 25, medium: 25 },
      { high: 20, medium: 30 },
      { high: 101, medium: 10 },
      { high: 50, medium: -1 },
      { high: 50.5, medium: 10 },
    ]) {
      expect(scoringVersionProblems(seeded(), t).join(' ')).toMatch(/umbrales/);
    }
  });

  it('rechaza claves repetidas o inválidas, puntos fuera de rango, destino inválido y parámetros malos', () => {
    const [a, b] = seeded();
    const problems = scoringVersionProblems(
      [
        a,
        { ...b, key: a.key },
        { ...b, key: 'minúscula' },
        { ...b, key: 'PUNTOS', points: 150 },
        { ...b, key: 'DESTINO', appliesTo: [K.PROPERTY] },
        {
          ...b,
          key: 'PARAMS',
          predicate: GrowthScoringPredicate.UNITS_GT,
          params: { value: -3 },
        },
      ],
      thresholds,
    ).join(' | ');
    expect(problems).toMatch(/Clave repetida/);
    expect(problems).toMatch(/Clave inválida: minúscula/);
    expect(problems).toMatch(/PUNTOS: los puntos/);
    expect(problems).toMatch(/DESTINO: aplica solo a empresas o personas/);
    expect(problems).toMatch(/PARAMS: parámetros inválidos/);
  });

  it('exige al menos una regla activa', () => {
    expect(
      scoringVersionProblems(
        seeded().map((r) => ({ ...r, active: false })),
        thresholds,
      ),
    ).toContain('La versión necesita al menos una regla activa');
  });
});

describe('Versiones de scoring: separación de funciones al aprobar', () => {
  const draft = { createdByUserId: 'ana', contributorUserIds: ['ana', 'beto'] };

  it('aprueba alguien que no propuso ni editó el borrador', () => {
    expect(approvalDecision(draft, actor('carla'), true)).toEqual({
      allowed: true,
      selfException: false,
    });
  });

  it('no aprueba quien lo creó ni quien lo editó', () => {
    expect(approvalDecision(draft, actor('ana'), true).allowed).toBe(false);
    expect(approvalDecision(draft, actor('beto'), true).allowed).toBe(false);
  });

  it('SUPER_ADMIN contribuyente solo pasa con la excepción encendida, y queda marcado', () => {
    const root = actor('ana', [ValidRoles.SUPER_ADMIN_ROL]);
    expect(approvalDecision(draft, root, true)).toEqual({
      allowed: true,
      selfException: true,
    });
    expect(approvalDecision(draft, root, false).allowed).toBe(false);
    // Un SUPER_ADMIN que no participó aprueba sin excepción.
    expect(
      approvalDecision(
        draft,
        actor('root', [ValidRoles.SUPER_ADMIN_ROL]),
        false,
      ),
    ).toEqual({ allowed: true, selfException: false });
  });
});

describe('Versiones de scoring: cuándo crece el historial', () => {
  const base = {
    score: 70,
    priority: GrowthPriority.HIGH,
    versionId: 'v1',
    breakdown: [
      {
        ruleKey: 'VERIFIED_CHANNEL',
        label: 'Canal verificado',
        points: 10,
        basis: GrowthScoreBasis.VERIFIED,
      },
    ],
  };

  it('sin cambios no hay entrada nueva; cualquier cambio de puntaje, prioridad, versión o desglose sí', () => {
    expect(scoreChanged(null, base)).toBe(true);
    expect(scoreChanged(base, { ...base })).toBe(false);
    // jsonb reordena claves: un desglose igual con otro orden de claves no cuenta.
    const reordered = {
      ...base,
      breakdown: [
        {
          basis: GrowthScoreBasis.VERIFIED,
          points: 10,
          label: 'Canal verificado',
          ruleKey: 'VERIFIED_CHANNEL',
        },
      ],
    };
    expect(scoreChanged(base, reordered)).toBe(false);
    expect(scoreChanged(base, { ...base, score: 71 })).toBe(true);
    expect(
      scoreChanged(base, { ...base, priority: GrowthPriority.MEDIUM }),
    ).toBe(true);
    expect(scoreChanged(base, { ...base, versionId: 'v2' })).toBe(true);
    expect(scoreChanged(base, { ...base, breakdown: [] })).toBe(true);
  });
});
