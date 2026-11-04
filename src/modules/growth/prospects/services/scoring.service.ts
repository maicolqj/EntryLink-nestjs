import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import {
  GrowthScoreItem,
  ProspectScore,
  ScoringRule,
} from '../entities/dedupe-scoring.entity';
import { GrowthSettings } from '../entities/growth-settings.entity';
import { Organization } from '../entities/organization.entity';
import { Person } from '../entities/person.entity';
import {
  GrowthEvidenceStatus,
  GrowthInterestSignal,
  GrowthPriority,
  GrowthProspectKind,
  GrowthScoreBasis,
} from '../prospects.enums';
import { evaluateRule, ProspectFacts, RuleLike } from '../shared/scoring-rules';
import { activeScoringVersion, scoreChanged } from '../shared/scoring-versions';
import { ProspectEventsService } from './prospect-events.service';

export type ScorableKind =
  GrowthProspectKind.ORGANIZATION | GrowthProspectKind.PERSON;

/**
 * Scoring comercial configurable. Ordena la bandeja: nunca valida un
 * prospecto ni autoriza contacto. Cada regla del desglose indica si se
 * evaluó con datos VERIFIED o ESTIMATED.
 */
@Injectable()
export class ScoringService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
    @Optional() private readonly events?: ProspectEventsService,
  ) {}

  // ── Cálculo ────────────────────────────────────────────────────────────────

  /**
   * Recalcula y guarda el puntaje vigente. Personas que no son
   * administradores independientes, y registros fusionados o descartados, no
   * tienen puntaje (se borra si existía).
   */
  async recompute(
    kind: ScorableKind,
    id: string,
  ): Promise<ProspectScore | null> {
    return this.dataSource.transaction(async (manager) => {
      const column =
        kind === GrowthProspectKind.ORGANIZATION
          ? 'organization_id'
          : 'person_id';
      // Un recálculo a la vez por prospecto: el historial no se duplica.
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`growth-score:${kind}:${id}`],
      );
      const record =
        kind === GrowthProspectKind.ORGANIZATION
          ? await manager.findOne(Organization, {
              where: { id },
              withDeleted: true,
            })
          : await manager.findOne(Person, { where: { id }, withDeleted: true });
      const scorable =
        !!record &&
        !record.deletedAt &&
        !record.mergedIntoId &&
        (kind === GrowthProspectKind.ORGANIZATION ||
          (record as Person).isIndependentAdmin);
      if (!scorable) {
        // El historial se conserva: solo deja de haber puntaje vigente.
        await manager.query(
          `DELETE FROM growth.prospect_scores WHERE ${column} = $1`,
          [id],
        );
        return null;
      }

      // Siempre la versión ACTIVE: la misma fuente que usa la simulación.
      const version = await activeScoringVersion(manager);
      const settings = await manager.findOneOrFail(GrowthSettings, {
        where: { id: 1 },
      });
      const facts = (
        await this.factsFor(manager, kind, [toScorable(record)])
      ).get(id);
      const computed = computeScore(
        version.rules,
        version.thresholds,
        kind,
        facts,
      );
      const where =
        kind === GrowthProspectKind.ORGANIZATION
          ? { organizationId: id }
          : { personId: id };
      const previous = await manager.findOne(ProspectScore, { where });

      await manager.query(
        `INSERT INTO growth.prospect_scores (${column}, score, priority, breakdown, has_estimates, rules_version, version_id, computed_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now())
         ON CONFLICT (${column}) WHERE ${column} IS NOT NULL DO UPDATE
           SET score = EXCLUDED.score, priority = EXCLUDED.priority, breakdown = EXCLUDED.breakdown,
               has_estimates = EXCLUDED.has_estimates, rules_version = EXCLUDED.rules_version,
               version_id = EXCLUDED.version_id, computed_at = EXCLUDED.computed_at`,
        [
          id,
          computed.score,
          computed.priority,
          JSON.stringify(computed.breakdown),
          computed.hasEstimates,
          settings.scoringVersion,
          version.id,
        ],
      );
      if (
        scoreChanged(previous, {
          score: computed.score,
          priority: computed.priority,
          breakdown: computed.breakdown,
          versionId: version.id,
        })
      ) {
        await manager.query(
          `INSERT INTO growth.prospect_score_history (${column}, score, priority, breakdown, has_estimates, version_id, rules_version)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [
            id,
            computed.score,
            computed.priority,
            JSON.stringify(computed.breakdown),
            computed.hasEstimates,
            version.id,
            settings.scoringVersion,
          ],
        );
      }
      return manager.findOneOrFail(ProspectScore, { where });
    });
  }

  /** Lista de prospectos a recalcular tras un cambio de reglas. */
  async scorableIds(): Promise<Array<{ kind: ScorableKind; id: string }>> {
    const rows: Array<{ kind: ScorableKind; id: string }> =
      await this.dataSource.query(
        `SELECT 'ORGANIZATION' AS kind, id FROM growth.organizations WHERE deleted_at IS NULL AND merged_into_id IS NULL
       UNION ALL
       SELECT 'PERSON' AS kind, id FROM growth.people WHERE deleted_at IS NULL AND merged_into_id IS NULL AND is_independent_admin`,
      );
    return rows;
  }

  getScore(
    kind: GrowthProspectKind,
    id: string,
  ): Promise<ProspectScore | null> {
    if (kind === GrowthProspectKind.PROPERTY) return Promise.resolve(null);
    return this.dataSource.manager.findOne(ProspectScore, {
      where:
        kind === GrowthProspectKind.ORGANIZATION
          ? { organizationId: id }
          : { personId: id },
    });
  }

  /**
   * Hechos de varios prospectos del mismo tipo, en 4 consultas sin importar
   * cuántos sean. Copropiedades y unidades: si todas las copropiedades
   * administradas están VALIDATED, la base es VERIFIED; si alguna no,
   * ESTIMATED; sin copropiedades registradas se usa el estimado declarado de
   * la empresa (ESTIMATED). Lo usan el recálculo (un registro) y la
   * simulación (todos): mismo cálculo en los dos casos.
   */
  async factsFor(
    manager: EntityManager,
    kind: ScorableKind,
    records: ScorableRecord[],
  ): Promise<Map<string, ProspectFacts>> {
    const out = new Map<string, ProspectFacts>();
    if (records.length === 0) return out;
    const isOrg = kind === GrowthProspectKind.ORGANIZATION;
    const ids = records.map((r) => r.id);

    const managedRows: Array<{
      id: string;
      total: number;
      validated: number;
      units: number;
      units_validated: number;
    }> = await manager.query(
      `SELECT ${isOrg ? 'm.organization_id' : 'm.person_id'} AS id,
              count(*)::int AS total,
              count(*) FILTER (WHERE p.validation_status = 'VALIDATED')::int AS validated,
              coalesce(sum(p.estimated_units), 0)::int AS units,
              count(*) FILTER (WHERE p.estimated_units IS NOT NULL AND p.validation_status <> 'VALIDATED')::int AS units_validated
         FROM growth.property_managements m
         JOIN growth.properties p ON p.id = m.property_id
        WHERE m.status <> 'PAST' AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
          AND ${isOrg ? `m.organization_id = ANY($1::uuid[])` : `m.person_id = ANY($1::uuid[]) AND m.manager_type = 'PERSON'`}
        GROUP BY 1`,
      [ids],
    );
    const managedById = new Map(managedRows.map((m) => [m.id, m]));

    const channelRows: Array<{ id: string }> = await manager.query(
      isOrg
        ? `SELECT DISTINCT organization_id AS id FROM growth.organization_channels
            WHERE organization_id = ANY($1::uuid[]) AND verified_at IS NOT NULL AND deleted_at IS NULL AND kind <> 'SOCIAL'`
        : `SELECT DISTINCT person_id AS id FROM growth.person_channels
            WHERE person_id = ANY($1::uuid[]) AND verified_at IS NOT NULL AND deleted_at IS NULL AND kind <> 'SOCIAL'
              AND channel_class = 'PROFESSIONAL'`,
      [ids],
    );
    const withChannel = new Set(channelRows.map((r) => r.id));

    const interestRows: Array<{ id: string }> = await manager.query(
      `SELECT DISTINCT entity_id AS id FROM growth.evidences
        WHERE entity_type = $2 AND entity_id = ANY($1::uuid[])
          AND field = 'interestSignal' AND verification_status = $3`,
      [
        ids,
        isOrg ? GrowthEntityType.ORGANIZATION : GrowthEntityType.PERSON,
        GrowthEvidenceStatus.VERIFIED,
      ],
    );
    const interestVerified = new Set(interestRows.map((r) => r.id));

    for (const record of records) {
      const managed = managedById.get(record.id) ?? {
        total: 0,
        validated: 0,
        units: 0,
        units_validated: 0,
      };
      const allVerified =
        managed.total > 0 && managed.validated === managed.total;
      const properties =
        managed.total > 0
          ? {
              value: managed.total,
              basis: allVerified
                ? GrowthScoreBasis.VERIFIED
                : GrowthScoreBasis.ESTIMATED,
            }
          : {
              value: (isOrg ? record.estimatedProperties : null) ?? 0,
              basis: GrowthScoreBasis.ESTIMATED,
            };
      const units =
        managed.total > 0 && managed.units > 0
          ? {
              value: managed.units,
              basis:
                managed.units_validated === 0 && allVerified
                  ? GrowthScoreBasis.VERIFIED
                  : GrowthScoreBasis.ESTIMATED,
            }
          : {
              value: (isOrg ? record.estimatedUnits : null) ?? 0,
              basis: GrowthScoreBasis.ESTIMATED,
            };
      out.set(record.id, {
        properties,
        units,
        verifiedChannel: withChannel.has(record.id),
        interestSignal: {
          value: record.interestSignal ?? GrowthInterestSignal.NONE,
          basis: interestVerified.has(record.id)
            ? GrowthScoreBasis.VERIFIED
            : GrowthScoreBasis.ESTIMATED,
        },
      });
    }
    return out;
  }

  // ── Configuración ──────────────────────────────────────────────────────────

  listRules(): Promise<ScoringRule[]> {
    return this.dataSource.manager.find(ScoringRule, {
      order: { sortOrder: 'ASC' },
    });
  }

  /**
   * Desde 1E-C-0 las reglas y los umbrales solo cambian en un borrador de
   * versión que alguien distinto aprueba (ScoringVersionsService). Estas
   * operaciones de 1B siguen en la API para no romper el contrato, pero ya
   * no aplican cambios al instante.
   */
  createRule(): Promise<never> {
    return Promise.reject(requiresApproval());
  }

  updateRule(): Promise<never> {
    return Promise.reject(requiresApproval());
  }

  updateThresholds(): Promise<never> {
    return Promise.reject(requiresApproval());
  }
}

function requiresApproval(): CustomError {
  return new CustomError({
    message:
      'Las reglas y los umbrales se cambian en un borrador de versión, que otra persona aprueba',
    statusCode: HttpStatus.CONFLICT,
    errorCode: GrowthErrorCode.GROWTH_SCORING_REQUIRES_APPROVAL,
  });
}

/** Lo mínimo de un registro que necesita el cálculo de hechos. */
export interface ScorableRecord {
  id: string;
  estimatedProperties?: number | null;
  estimatedUnits?: number | null;
  interestSignal?: GrowthInterestSignal | null;
}

function toScorable(record: Organization | Person): ScorableRecord {
  const org = record as Organization;
  return {
    id: record.id,
    estimatedProperties: org.estimatedProperties ?? null,
    estimatedUnits: org.estimatedUnits ?? null,
    interestSignal: record.interestSignal ?? null,
  };
}

export interface ScoreThresholds {
  high: number;
  medium: number;
}

export interface ComputedScore {
  score: number;
  priority: GrowthPriority;
  breakdown: GrowthScoreItem[];
  hasEstimates: boolean;
}

/**
 * EL motor: reglas activas que aplican al tipo, en su orden, sumadas y
 * acotadas a 0–100; la prioridad sale de los umbrales. El recálculo guardado
 * y la simulación usan esta misma función.
 */
export function computeScore(
  rules: Array<
    Pick<
      ScoringRule,
      'key' | 'label' | 'points' | 'appliesTo' | 'active' | 'sortOrder'
    > &
      RuleLike
  >,
  thresholds: ScoreThresholds,
  kind: ScorableKind,
  facts: ProspectFacts,
): ComputedScore {
  const breakdown: GrowthScoreItem[] = [];
  const applicable = rules
    .filter((r) => r.active && r.appliesTo.includes(kind))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const rule of applicable) {
    const hit = evaluateRule(rule, facts);
    if (hit) {
      breakdown.push({
        ruleKey: rule.key,
        label: rule.label,
        points: rule.points,
        basis: hit.basis,
        value: hit.value,
      });
    }
  }
  const score = Math.max(
    0,
    Math.min(
      100,
      breakdown.reduce((a, b) => a + b.points, 0),
    ),
  );
  return {
    score,
    priority: priorityFor(score, thresholds),
    breakdown,
    hasEstimates: breakdown.some((b) => b.basis === GrowthScoreBasis.ESTIMATED),
  };
}

export function priorityFor(
  score: number,
  thresholds: ScoreThresholds,
): GrowthPriority {
  return score >= thresholds.high
    ? GrowthPriority.HIGH
    : score >= thresholds.medium
      ? GrowthPriority.MEDIUM
      : GrowthPriority.LOW;
}
