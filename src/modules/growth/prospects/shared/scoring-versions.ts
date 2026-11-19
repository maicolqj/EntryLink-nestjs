import { EntityManager } from 'typeorm';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthScoreItem } from '../entities/dedupe-scoring.entity';
import {
  ScoringVersion,
  ScoringVersionRule,
  ScoringVersionThresholds,
} from '../entities/scoring-version.entity';
import {
  GrowthPriority,
  GrowthProspectKind,
  GrowthScoringPredicate,
  GrowthScoringVersionStatus,
} from '../prospects.enums';
import { validateRuleParams } from './scoring-rules';

/*
 * Reglas de las versiones de scoring, sin base de datos (las prueba
 * scoring-versions.spec.ts). El cálculo es siempre `computeScore`: aquí solo
 * se valida un borrador, se decide quién puede aprobarlo y se compara un
 * puntaje con el anterior.
 */

export const MAX_RULES_PER_VERSION = 50;
export const MAX_POINTS = 100;
const SCORABLE: GrowthProspectKind[] = [
  GrowthProspectKind.ORGANIZATION,
  GrowthProspectKind.PERSON,
];
const KEY = /^[A-Z][A-Z0-9_]{1,39}$/;

/** Problemas de un conjunto de reglas y umbrales; vacío si sirve. */
export function scoringVersionProblems(
  rules: ScoringVersionRule[],
  thresholds: ScoringVersionThresholds,
): string[] {
  const problems: string[] = [];
  if (!Array.isArray(rules)) return ['Las reglas deben ser una lista'];
  if (rules.length > MAX_RULES_PER_VERSION) {
    problems.push(`Una versión admite hasta ${MAX_RULES_PER_VERSION} reglas`);
  }
  if (!rules.some((r) => r.active)) {
    problems.push('La versión necesita al menos una regla activa');
  }
  const keys = new Set<string>();
  for (const r of rules) {
    const name = r.key || '(sin clave)';
    if (!KEY.test(r.key ?? '')) {
      problems.push(`Clave inválida: ${name} (MAYÚSCULAS, números y _)`);
    }
    if (keys.has(r.key)) problems.push(`Clave repetida: ${name}`);
    keys.add(r.key);
    const label = (r.label ?? '').trim();
    if (!label || label.length > 120) {
      problems.push(`${name}: el rótulo debe tener entre 1 y 120 caracteres`);
    }
    if (!Object.values(GrowthScoringPredicate).includes(r.predicate)) {
      problems.push(`${name}: predicado desconocido`);
    } else {
      const p = validateRuleParams({
        predicate: r.predicate,
        params: r.params ?? {},
      });
      if (p) problems.push(`${name}: parámetros inválidos (${p})`);
    }
    if (!Number.isInteger(r.points) || Math.abs(r.points) > MAX_POINTS) {
      problems.push(`${name}: los puntos son un entero entre -100 y 100`);
    }
    if (
      !Array.isArray(r.appliesTo) ||
      r.appliesTo.length === 0 ||
      r.appliesTo.some((k) => !SCORABLE.includes(k))
    ) {
      problems.push(`${name}: aplica solo a empresas o personas`);
    }
    if (
      !Number.isInteger(r.sortOrder) ||
      r.sortOrder < 0 ||
      r.sortOrder > 10000
    ) {
      problems.push(`${name}: el orden es un entero entre 0 y 10000`);
    }
    if (typeof r.active !== 'boolean')
      problems.push(`${name}: falta si está activa`);
  }
  const { high, medium } = thresholds ?? ({} as ScoringVersionThresholds);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(medium) ||
    medium < 0 ||
    high > 100 ||
    medium >= high
  ) {
    problems.push(
      'Los umbrales son enteros entre 0 y 100 y el medio es menor que el alto',
    );
  }
  return problems;
}

export interface ApprovalDecision {
  allowed: boolean;
  /** Aprobó quien la propuso o editó, por la excepción de SUPER_ADMIN. */
  selfException: boolean;
}

/**
 * Separación de funciones: no aprueba quien creó o editó el borrador. La
 * única excepción es SUPER_ADMIN con `allowSuperAdminSelfValidation`, la
 * misma que ya rige la validación de prospectos, y queda auditada.
 */
export function approvalDecision(
  version: Pick<ScoringVersion, 'createdByUserId' | 'contributorUserIds'>,
  actor: JwtAccessPayload,
  allowSuperAdminSelf: boolean,
): ApprovalDecision {
  const involved =
    version.createdByUserId === actor.sub ||
    (version.contributorUserIds ?? []).includes(actor.sub);
  if (!involved) return { allowed: true, selfException: false };
  const isSuperAdmin = !!actor.roles?.includes(ValidRoles.SUPER_ADMIN_ROL);
  if (isSuperAdmin && allowSuperAdminSelf) {
    return { allowed: true, selfException: true };
  }
  return { allowed: false, selfException: false };
}

/** Forma comparable de un desglose (jsonb reordena las claves). */
function breakdownKey(items: GrowthScoreItem[]): string {
  return (items ?? [])
    .map((i) => [i.ruleKey, i.points, i.basis, i.value ?? null].join('|'))
    .join(';');
}

export interface ScoreSnapshot {
  score: number;
  priority: GrowthPriority;
  breakdown: GrowthScoreItem[];
  versionId: string | null;
}

/** Si el nuevo cálculo merece una entrada en el historial. */
export function scoreChanged(
  previous: ScoreSnapshot | null,
  next: ScoreSnapshot,
): boolean {
  if (!previous) return true;
  return (
    previous.score !== next.score ||
    previous.priority !== next.priority ||
    previous.versionId !== next.versionId ||
    breakdownKey(previous.breakdown) !== breakdownKey(next.breakdown)
  );
}

/** La versión ACTIVE; sin ella el scoring está mal configurado. */
export async function activeScoringVersion(
  manager: EntityManager,
): Promise<ScoringVersion> {
  const version = await manager.findOne(ScoringVersion, {
    where: { status: GrowthScoringVersionStatus.ACTIVE },
  });
  if (!version) {
    throw new Error(
      'No hay una versión de scoring activa: la migración siembra la versión 1',
    );
  }
  return version;
}
