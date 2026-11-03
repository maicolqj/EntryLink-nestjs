import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { actorHas } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { ScoringRule } from '../entities/dedupe-scoring.entity';
import { GrowthSettings } from '../entities/growth-settings.entity';
import {
  GrowthInterestSignal,
  GrowthPriority,
  GrowthProspectKind,
} from '../prospects.enums';
import {
  GrowthScoringRuleChangeInput,
  GrowthScoringSimulationInput,
} from '../dto/inputs/scoring-simulation.inputs';
import {
  GrowthScoringDistribution,
  GrowthScoringSimulation,
  GrowthScoringSimulationItem,
  GrowthScoringTransition,
} from '../dto/responses/scoring-simulation.responses';
import { validateRuleParams } from '../shared/scoring-rules';
import {
  ComputedScore,
  computeScore,
  ScorableKind,
  ScorableRecord,
  ScoreThresholds,
  ScoringService,
} from './scoring.service';

/** Regla en memoria: lo que usa el motor, sin columnas de auditoría. */
type SimRule = Pick<
  ScoringRule,
  | 'key'
  | 'label'
  | 'predicate'
  | 'params'
  | 'points'
  | 'appliesTo'
  | 'active'
  | 'sortOrder'
>;

interface Row extends ScorableRecord {
  display_name: string;
  estimated_properties: number | null;
  estimated_units: number | null;
  interest_signal: GrowthInterestSignal | null;
}

const PRIORITIES = [
  GrowthPriority.HIGH,
  GrowthPriority.MEDIUM,
  GrowthPriority.LOW,
];

/**
 * Simulación del scoring: aplica en memoria los cambios propuestos y calcula,
 * con el mismo motor (`computeScore` + `ScoringService.factsFor`), el puntaje
 * vigente y el propuesto de cada prospecto.
 *
 * No guarda nada: corre en una transacción READ ONLY (Postgres rechaza
 * cualquier escritura) y no sube la versión, no registra actividad ni encola
 * recálculos. Ambos lados se calculan en vivo sobre la misma foto de datos,
 * así que la comparación no depende de que los puntajes guardados estén al día.
 */
@Injectable()
export class ScoringSimulationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly scoring: ScoringService,
  ) {}

  async simulate(
    input: GrowthScoringSimulationInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthScoringSimulation> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const settings = await manager.findOneOrFail(GrowthSettings, {
        where: { id: 1 },
      });
      const currentRules: SimRule[] = await manager.find(ScoringRule, {
        order: { sortOrder: 'ASC' },
      });
      const proposedRules = applyChanges(currentRules, input.ruleChanges ?? []);
      const currentT: ScoreThresholds = {
        high: settings.scoringHighThreshold,
        medium: settings.scoringMediumThreshold,
      };
      const proposedT: ScoreThresholds = input.thresholds ?? currentT;
      if (proposedT.high <= proposedT.medium) {
        throw invalid('El umbral alto debe ser mayor que el medio');
      }

      const scored: Array<{
        kind: ScorableKind;
        row: Row;
        current: ComputedScore;
        proposed: ComputedScore;
      }> = [];
      for (const kind of [
        GrowthProspectKind.ORGANIZATION,
        GrowthProspectKind.PERSON,
      ] as ScorableKind[]) {
        const rows: Row[] = await manager.query(
          kind === GrowthProspectKind.ORGANIZATION
            ? `SELECT id, legal_name AS display_name, estimated_properties, estimated_units, interest_signal
                 FROM growth.organizations WHERE deleted_at IS NULL AND merged_into_id IS NULL`
            : `SELECT id, full_name AS display_name, NULL::int AS estimated_properties, NULL::int AS estimated_units, interest_signal
                 FROM growth.people WHERE deleted_at IS NULL AND merged_into_id IS NULL AND is_independent_admin`,
        );
        const facts = await this.scoring.factsFor(
          manager,
          kind,
          rows.map((r) => ({
            id: r.id,
            estimatedProperties: r.estimated_properties,
            estimatedUnits: r.estimated_units,
            interestSignal: r.interest_signal,
          })),
        );
        for (const row of rows) {
          const f = facts.get(row.id);
          scored.push({
            kind,
            row,
            current: computeScore(currentRules, currentT, kind, f),
            proposed: computeScore(proposedRules, proposedT, kind, f),
          });
        }
      }

      const changed = scored.filter(
        (s) =>
          s.current.score !== s.proposed.score ||
          s.current.priority !== s.proposed.priority,
      );
      const canSeeAll = actorHas(
        actor,
        ValidPermissions.VIEW_ALL_GROWTH_PROSPECTS,
      );
      const items: GrowthScoringSimulationItem[] = canSeeAll
        ? changed
            .map((s) => ({
              kind: s.kind,
              id: s.row.id,
              displayName: s.row.display_name,
              currentScore: s.current.score,
              proposedScore: s.proposed.score,
              delta: s.proposed.score - s.current.score,
              currentPriority: s.current.priority,
              proposedPriority: s.proposed.priority,
              currentBreakdown: s.current.breakdown,
              proposedBreakdown: s.proposed.breakdown,
            }))
            .sort(
              (a, b) =>
                Math.abs(b.delta) - Math.abs(a.delta) ||
                b.proposedScore - a.proposedScore ||
                a.id.localeCompare(b.id),
            )
            .slice(0, input.sampleLimit ?? 25)
        : [];

      const transitions: GrowthScoringTransition[] = [];
      for (const from of PRIORITIES) {
        for (const to of PRIORITIES) {
          const count = scored.filter(
            (s) => s.current.priority === from && s.proposed.priority === to,
          ).length;
          if (count > 0) transitions.push({ from, to, count });
        }
      }

      return {
        scoringVersion: settings.scoringVersion,
        evaluated: scored.length,
        changedScore: scored.filter((s) => s.current.score !== s.proposed.score)
          .length,
        changedPriority: scored.filter(
          (s) => s.current.priority !== s.proposed.priority,
        ).length,
        current: distribution(
          scored.map((s) => s.current),
          currentT,
        ),
        proposed: distribution(
          scored.map((s) => s.proposed),
          proposedT,
        ),
        transitions,
        items,
        itemsHidden: !canSeeAll,
      };
    });
  }
}

/**
 * Aplica los cambios con las mismas reglas de validación que
 * `createRule`/`updateRule`, sin tocar la base.
 */
export function applyChanges(
  current: SimRule[],
  changes: GrowthScoringRuleChangeInput[],
): SimRule[] {
  const byId = new Map(
    current.map((r) => [
      (r as ScoringRule).id,
      { ...r, params: { ...r.params } },
    ]),
  );
  const added: SimRule[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    if (change.ruleId) {
      if (seen.has(change.ruleId)) {
        throw invalid('Cada regla se modifica una sola vez por simulación');
      }
      seen.add(change.ruleId);
      const rule = byId.get(change.ruleId);
      if (!rule) {
        throw new CustomError({
          message: 'Regla no encontrada',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
        });
      }
      if (change.key) throw invalid('La clave de una regla no se cambia');
      if (change.label) rule.label = change.label.trim();
      if (change.predicate) rule.predicate = change.predicate;
      if (change.params) rule.params = change.params;
      if (change.points !== undefined) rule.points = change.points;
      if (change.appliesTo) rule.appliesTo = change.appliesTo;
      if (change.active !== undefined) rule.active = change.active;
      if (change.sortOrder !== undefined) rule.sortOrder = change.sortOrder;
      assertParams(rule);
    } else {
      if (
        !change.key ||
        !change.label ||
        !change.predicate ||
        change.points === undefined ||
        !change.appliesTo
      ) {
        throw invalid(
          'Una regla nueva exige key, label, predicate, points y appliesTo',
        );
      }
      const taken =
        current.some((r) => r.key === change.key) ||
        added.some((r) => r.key === change.key);
      if (taken) throw invalid(`Ya existe la regla ${change.key}`);
      const rule: SimRule = {
        key: change.key,
        label: change.label.trim(),
        predicate: change.predicate,
        params: change.params ?? {},
        points: change.points,
        appliesTo: change.appliesTo,
        active: change.active ?? true,
        sortOrder: change.sortOrder ?? 100,
      };
      assertParams(rule);
      added.push(rule);
    }
  }
  return [...byId.values(), ...added];
}

function distribution(
  scores: ComputedScore[],
  t: ScoreThresholds,
): GrowthScoringDistribution {
  const count = (p: GrowthPriority) =>
    scores.filter((s) => s.priority === p).length;
  const avg =
    scores.length === 0
      ? 0
      : scores.reduce((a, s) => a + s.score, 0) / scores.length;
  return {
    high: count(GrowthPriority.HIGH),
    medium: count(GrowthPriority.MEDIUM),
    low: count(GrowthPriority.LOW),
    averageScore: Math.round(avg * 10) / 10,
    highThreshold: t.high,
    mediumThreshold: t.medium,
  };
}

function assertParams(rule: SimRule): void {
  const problem = validateRuleParams(rule);
  if (problem) {
    throw invalid(`Parámetros inválidos para ${rule.predicate}: ${problem}`);
  }
}

function invalid(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
  });
}
