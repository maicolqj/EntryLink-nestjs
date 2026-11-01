import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
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
import { Evidence } from '../entities/evidence.entity';
import {
  GrowthEvidenceStatus,
  GrowthInterestSignal,
  GrowthPriority,
  GrowthProspectKind,
  GrowthScoreBasis,
} from '../prospects.enums';
import {
  GrowthScoringRuleInput,
  GrowthScoringThresholdsInput,
} from '../dto/inputs/dedupe-scoring.inputs';
import {
  evaluateRule,
  ProspectFacts,
  validateRuleParams,
} from '../shared/scoring-rules';
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
        await manager.query(
          `DELETE FROM growth.prospect_scores WHERE ${column} = $1`,
          [id],
        );
        return null;
      }

      const settings = await manager.findOneOrFail(GrowthSettings, {
        where: { id: 1 },
      });
      const rules = await manager.find(ScoringRule, {
        where: { active: true },
        order: { sortOrder: 'ASC' },
      });
      const facts = await this.facts(manager, kind, record);
      const breakdown: GrowthScoreItem[] = [];
      for (const rule of rules.filter((r) => r.appliesTo.includes(kind))) {
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
      const priority =
        score >= settings.scoringHighThreshold
          ? GrowthPriority.HIGH
          : score >= settings.scoringMediumThreshold
            ? GrowthPriority.MEDIUM
            : GrowthPriority.LOW;
      const hasEstimates = breakdown.some(
        (b) => b.basis === GrowthScoreBasis.ESTIMATED,
      );

      await manager.query(
        `INSERT INTO growth.prospect_scores (${column}, score, priority, breakdown, has_estimates, rules_version, computed_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
         ON CONFLICT (${column}) WHERE ${column} IS NOT NULL DO UPDATE
           SET score = EXCLUDED.score, priority = EXCLUDED.priority, breakdown = EXCLUDED.breakdown,
               has_estimates = EXCLUDED.has_estimates, rules_version = EXCLUDED.rules_version,
               computed_at = EXCLUDED.computed_at`,
        [
          id,
          score,
          priority,
          JSON.stringify(breakdown),
          hasEstimates,
          settings.scoringVersion,
        ],
      );
      return manager.findOneOrFail(ProspectScore, {
        where:
          kind === GrowthProspectKind.ORGANIZATION
            ? { organizationId: id }
            : { personId: id },
      });
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
   * Hechos del prospecto. Copropiedades y unidades: si todas las
   * copropiedades administradas están VALIDATED, la base es VERIFIED; si
   * alguna no, ESTIMATED; sin copropiedades registradas se usa el estimado
   * declarado de la empresa (ESTIMATED).
   */
  private async facts(
    manager: EntityManager,
    kind: ScorableKind,
    record: Organization | Person,
  ): Promise<ProspectFacts> {
    const isOrg = kind === GrowthProspectKind.ORGANIZATION;
    const [managed]: Array<{
      total: number;
      validated: number;
      units: number;
      units_validated: number;
    }> = await manager.query(
      `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE p.validation_status = 'VALIDATED')::int AS validated,
                coalesce(sum(p.estimated_units), 0)::int AS units,
                count(*) FILTER (WHERE p.estimated_units IS NOT NULL AND p.validation_status <> 'VALIDATED')::int AS units_validated
           FROM growth.property_managements m
           JOIN growth.properties p ON p.id = m.property_id
          WHERE m.status <> 'PAST' AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
            AND ${isOrg ? `m.organization_id = $1` : `m.person_id = $1 AND m.manager_type = 'PERSON'`}`,
      [record.id],
    );
    const org = isOrg ? (record as Organization) : null;
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
            value: org?.estimatedProperties ?? 0,
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
            value: org?.estimatedUnits ?? 0,
            basis: GrowthScoreBasis.ESTIMATED,
          };

    const [channel]: Array<{ ok: boolean }> = await manager.query(
      isOrg
        ? `SELECT EXISTS (SELECT 1 FROM growth.organization_channels
             WHERE organization_id = $1 AND verified_at IS NOT NULL AND deleted_at IS NULL AND kind <> 'SOCIAL') AS ok`
        : `SELECT EXISTS (SELECT 1 FROM growth.person_channels
             WHERE person_id = $1 AND verified_at IS NOT NULL AND deleted_at IS NULL AND kind <> 'SOCIAL'
               AND channel_class = 'PROFESSIONAL') AS ok`,
      [record.id],
    );

    const interestVerified = await manager.exists(Evidence, {
      where: {
        entityType: isOrg
          ? GrowthEntityType.ORGANIZATION
          : GrowthEntityType.PERSON,
        entityId: record.id,
        field: 'interestSignal',
        verificationStatus: GrowthEvidenceStatus.VERIFIED,
      },
    });

    return {
      properties,
      units,
      verifiedChannel: channel.ok,
      interestSignal: {
        value: record.interestSignal ?? GrowthInterestSignal.NONE,
        basis: interestVerified
          ? GrowthScoreBasis.VERIFIED
          : GrowthScoreBasis.ESTIMATED,
      },
    };
  }

  // ── Configuración ──────────────────────────────────────────────────────────

  listRules(): Promise<ScoringRule[]> {
    return this.dataSource.manager.find(ScoringRule, {
      order: { sortOrder: 'ASC' },
    });
  }

  async createRule(
    input: GrowthScoringRuleInput,
    actor: JwtAccessPayload,
  ): Promise<ScoringRule> {
    if (
      !input.key ||
      !input.label ||
      !input.predicate ||
      input.points === undefined ||
      !input.appliesTo
    ) {
      throw invalid(
        'Crear una regla exige key, label, predicate, points y appliesTo',
      );
    }
    this.assertParams(input.predicate, input.params ?? {});
    return this.changeRules(actor, async (manager) => {
      const exists = await manager.exists(ScoringRule, {
        where: { key: input.key },
      });
      if (exists) throw invalid(`Ya existe la regla ${input.key}`);
      const rule = await manager.save(
        manager.create(ScoringRule, {
          key: input.key,
          label: input.label.trim(),
          predicate: input.predicate,
          params: input.params ?? {},
          points: input.points,
          appliesTo: input.appliesTo,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 100,
          updatedByUserId: actor.sub,
        }),
      );
      return {
        rule,
        action: 'SCORING_RULE_CREATED',
        changes: {
          key: rule.key,
          predicate: rule.predicate,
          points: rule.points,
        },
      };
    });
  }

  async updateRule(
    id: string,
    input: GrowthScoringRuleInput,
    actor: JwtAccessPayload,
  ): Promise<ScoringRule> {
    if (input.key) throw invalid('La clave de una regla no se cambia');
    return this.changeRules(actor, async (manager) => {
      const rule = await manager.findOne(ScoringRule, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!rule) {
        throw new CustomError({
          message: 'Regla no encontrada',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
        });
      }
      const before = {
        points: rule.points,
        active: rule.active,
        params: rule.params,
        predicate: rule.predicate,
      };
      if (input.label) rule.label = input.label.trim();
      if (input.predicate) rule.predicate = input.predicate;
      if (input.params) rule.params = input.params;
      if (input.points !== undefined) rule.points = input.points;
      if (input.appliesTo) rule.appliesTo = input.appliesTo;
      if (input.active !== undefined) rule.active = input.active;
      if (input.sortOrder !== undefined) rule.sortOrder = input.sortOrder;
      this.assertParams(rule.predicate, rule.params);
      rule.updatedByUserId = actor.sub;
      const saved = await manager.save(rule);
      return {
        rule: saved,
        action: 'SCORING_RULE_UPDATED',
        changes: {
          key: saved.key,
          before,
          after: {
            points: saved.points,
            active: saved.active,
            params: saved.params,
            predicate: saved.predicate,
          },
        },
      };
    });
  }

  async updateThresholds(
    input: GrowthScoringThresholdsInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthSettings> {
    if (input.high <= input.medium)
      throw invalid('El umbral alto debe ser mayor que el medio');
    let settings!: GrowthSettings;
    await this.changeRules(actor, async (manager) => {
      const s = await manager.findOneOrFail(GrowthSettings, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      const before = {
        high: s.scoringHighThreshold,
        medium: s.scoringMediumThreshold,
      };
      s.scoringHighThreshold = input.high;
      s.scoringMediumThreshold = input.medium;
      settings = await manager.save(s);
      return {
        rule: null,
        action: 'SCORING_THRESHOLDS_UPDATED',
        changes: { before, after: input },
      };
    });
    return this.dataSource.manager.findOneOrFail(GrowthSettings, {
      where: { id: settings.id },
    });
  }

  /** Cualquier cambio de reglas sube la versión y recalcula todo en segundo plano. */
  private async changeRules<T extends ScoringRule | null>(
    actor: JwtAccessPayload,
    apply: (
      manager: EntityManager,
    ) => Promise<{ rule: T; action: string; changes: Record<string, unknown> }>,
  ): Promise<T> {
    const result = await this.dataSource.transaction(async (manager) => {
      const out = await apply(manager);
      await manager.query(
        `UPDATE growth.settings SET scoring_version = scoring_version + 1, updated_at = now(), updated_by_user_id = $1 WHERE id = 1`,
        [actor.sub],
      );
      await this.activity.record(manager, actor, {
        action: out.action,
        entityType: out.rule
          ? GrowthEntityType.SCORING_RULE
          : GrowthEntityType.SETTINGS,
        entityId: out.rule
          ? out.rule.id
          : '00000000-0000-0000-0000-000000000001',
        changes: out.changes,
      });
      return out.rule;
    });
    await this.events?.rescoreAll();
    return result;
  }

  private assertParams(
    predicate: ScoringRule['predicate'],
    params: Record<string, unknown>,
  ): void {
    const problem = validateRuleParams({ predicate, params });
    if (problem)
      throw invalid(`Parámetros inválidos para ${predicate}: ${problem}`);
  }
}

function invalid(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
  });
}
