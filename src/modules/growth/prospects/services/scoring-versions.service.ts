import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { actorHas } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import {
  GrowthCreateScoringDraftInput,
  GrowthUpdateScoringDraftInput,
} from '../dto/inputs/scoring-versions.inputs';
import { paginate } from '../dto/responses/prospect.responses';
import { GrowthScoringSimulation } from '../dto/responses/scoring-simulation.responses';
import {
  GrowthScoringStatus,
  PaginatedGrowthScoreHistory,
} from '../dto/responses/scoring-versions.responses';
import { GrowthSettings } from '../entities/growth-settings.entity';
import {
  ProspectScoreHistory,
  ScoringVersion,
  ScoringVersionRule,
} from '../entities/scoring-version.entity';
import {
  GrowthProspectKind,
  GrowthScoringVersionOrigin as Origin,
  GrowthScoringVersionStatus as Status,
} from '../prospects.enums';
import {
  activeScoringVersion,
  approvalDecision,
  scoringVersionProblems,
} from '../shared/scoring-versions';
import { ProspectEventsService } from './prospect-events.service';
import { ProspectGuardsService } from './prospect-guards.service';
import { ScoringSimulationService } from './scoring-simulation.service';
import { ScorableKind, ScoringService } from './scoring.service';

/** Un solo cambio de versiones a la vez (numerar y activar). */
const VERSIONS_LOCK = 'growth-scoring-versions';

/**
 * Versiones de reglas y umbrales del scoring (1E-C-0).
 *
 * - Se edita solo un borrador (DRAFT). MANAGE_GROWTH_SCORING crea, edita y
 *   descarta borradores; quien lo hace queda como contribuyente.
 * - APPROVE_GROWTH_SCORING aprueba y activa. No aprueba ningún
 *   contribuyente, salvo SUPER_ADMIN con la excepción de separación de
 *   funciones encendida (queda en la actividad).
 * - Activar retira la anterior, refleja las reglas en `scoring_rules` y los
 *   umbrales en `settings` (lo que leen las consultas de 1B) y encola el
 *   recálculo de todos. Mientras termina, cada puntaje dice con qué versión
 *   se calculó y `growthScoringStatus` cuenta los pendientes; un cron pone al
 *   día los que se hayan quedado (fallo de Redis o del trabajo).
 * - El scoring solo ordena: nunca toca la base jurídica, la autorización de
 *   contacto ni los canales.
 */
@Injectable()
export class ScoringVersionsService {
  private readonly logger = new Logger(ScoringVersionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
    private readonly guards: ProspectGuardsService,
    private readonly scoring: ScoringService,
    private readonly simulation: ScoringSimulationService,
    @Optional() private readonly events?: ProspectEventsService,
  ) {}

  // ── Consultas ──────────────────────────────────────────────────────────────

  list(statuses?: Status[]): Promise<ScoringVersion[]> {
    return this.dataSource.manager.find(ScoringVersion, {
      where: statuses?.length ? { status: In(statuses) } : {},
      order: { number: 'DESC' },
      take: 100,
    });
  }

  async get(id: string): Promise<ScoringVersion> {
    const version = await this.dataSource.manager.findOne(ScoringVersion, {
      where: { id },
    });
    if (!version) throw notFound();
    return version;
  }

  async status(): Promise<GrowthScoringStatus> {
    const manager = this.dataSource.manager;
    const active = await activeScoringVersion(manager);
    const [counts]: Array<Record<string, number>> = await manager.query(
      `WITH scorable AS (${SCORABLE_SQL})
       SELECT count(*) FILTER (WHERE ps.version_id = $1)::int AS current,
              count(*) FILTER (WHERE ps.id IS NOT NULL AND ps.version_id IS DISTINCT FROM $1)::int AS stale,
              count(*) FILTER (WHERE ps.id IS NULL)::int AS missing
         FROM scorable s
         LEFT JOIN growth.prospect_scores ps
           ON (s.kind = 'ORGANIZATION' AND ps.organization_id = s.id)
           OR (s.kind = 'PERSON' AND ps.person_id = s.id)`,
      [active.id],
    );
    return {
      activeVersion: active,
      currentScores: counts.current,
      staleScores: counts.stale,
      missingScores: counts.missing,
    };
  }

  /** Historial de puntajes de un prospecto que el actor puede ver. */
  async history(
    kind: ScorableKind,
    id: string,
    actor: JwtAccessPayload,
    pagination: PaginationInput = { page: 1, limit: 25 },
  ): Promise<PaginatedGrowthScoreHistory> {
    const manager = this.dataSource.manager;
    await this.guards.findVisible(manager, kind, id, actor);
    const [items, total] = await manager.findAndCount(ProspectScoreHistory, {
      where:
        kind === GrowthProspectKind.ORGANIZATION
          ? { organizationId: id }
          : { personId: id },
      order: { computedAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });
    return paginate(items, total, pagination);
  }

  /**
   * Compara una versión (normalmente un borrador) con la ACTIVE sobre la
   * misma foto de datos y con el mismo motor que el cálculo definitivo. Corre
   * en una transacción de solo lectura: no guarda nada.
   */
  async compare(
    id: string,
    actor: JwtAccessPayload,
    sampleLimit = 25,
  ): Promise<GrowthScoringSimulation> {
    if (
      !actorHas(actor, ValidPermissions.MANAGE_GROWTH_SCORING) &&
      !actorHas(actor, ValidPermissions.APPROVE_GROWTH_SCORING)
    ) {
      throw forbidden(
        'Comparar versiones exige configurar o aprobar el scoring',
      );
    }
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const active = await activeScoringVersion(manager);
      const version = await manager.findOne(ScoringVersion, { where: { id } });
      if (!version) throw notFound();
      const settings = await manager.findOneOrFail(GrowthSettings, {
        where: { id: 1 },
      });
      return this.simulation.compare(
        manager,
        { rules: active.rules, thresholds: active.thresholds },
        { rules: version.rules, thresholds: version.thresholds },
        actor,
        Math.min(Math.max(sampleLimit, 0), 100),
        settings.scoringVersion,
      );
    });
  }

  // ── Borradores ─────────────────────────────────────────────────────────────

  async createDraft(
    input: GrowthCreateScoringDraftInput,
    actor: JwtAccessPayload,
  ): Promise<ScoringVersion> {
    return this.dataSource.transaction(async (manager) => {
      await lock(manager);
      const base = input.basedOnVersionId
        ? await manager.findOne(ScoringVersion, {
            where: { id: input.basedOnVersionId },
          })
        : await activeScoringVersion(manager);
      if (!base) throw notFound();
      const [{ next }]: Array<{ next: number }> = await manager.query(
        `SELECT coalesce(max(number), 0) + 1 AS next FROM growth.scoring_versions`,
      );
      const draft = await manager.save(
        manager.create(ScoringVersion, {
          number: next,
          status: Status.DRAFT,
          origin: Origin.USER,
          rules: base.rules.map((r) => ({ ...r, params: { ...r.params } })),
          thresholds: { ...base.thresholds },
          notes: input.notes?.trim() || null,
          basedOnVersionId: base.id,
          createdByUserId: actor.sub,
          contributorUserIds: [actor.sub],
        }),
      );
      await this.record(manager, actor, 'SCORING_DRAFT_CREATED', draft, {
        number: draft.number,
        basedOn: base.number,
      });
      return draft;
    });
  }

  async updateDraft(
    input: GrowthUpdateScoringDraftInput,
    actor: JwtAccessPayload,
  ): Promise<ScoringVersion> {
    return this.dataSource.transaction(async (manager) => {
      const draft = await this.lockDraft(manager, input.id);
      const rules: ScoringVersionRule[] = input.rules
        ? input.rules.map((r) => ({
            key: r.key,
            label: r.label.trim(),
            predicate: r.predicate,
            params: r.params ?? {},
            points: r.points,
            appliesTo: r.appliesTo,
            active: r.active,
            sortOrder: r.sortOrder,
          }))
        : draft.rules;
      const thresholds = input.thresholds
        ? { high: input.thresholds.high, medium: input.thresholds.medium }
        : draft.thresholds;
      const problems = scoringVersionProblems(rules, thresholds);
      if (problems.length) throw invalid(problems.join('. '));
      draft.rules = rules;
      draft.thresholds = thresholds;
      if (input.notes !== undefined) draft.notes = input.notes.trim() || null;
      if (!draft.contributorUserIds.includes(actor.sub)) {
        draft.contributorUserIds = [...draft.contributorUserIds, actor.sub];
      }
      const saved = await manager.save(draft);
      await this.record(manager, actor, 'SCORING_DRAFT_UPDATED', saved, {
        number: saved.number,
        rules: saved.rules.length,
        thresholds: saved.thresholds,
      });
      return saved;
    });
  }

  async discardDraft(
    id: string,
    reason: string,
    actor: JwtAccessPayload,
  ): Promise<ScoringVersion> {
    const why = (reason ?? '').trim();
    if (why.length < 5 || why.length > 500) {
      throw invalid('El motivo debe tener entre 5 y 500 caracteres');
    }
    return this.dataSource.transaction(async (manager) => {
      const draft = await this.lockDraft(manager, id);
      draft.status = Status.RETIRED;
      draft.retiredAt = new Date();
      draft.retiredReason = why;
      const saved = await manager.save(draft);
      await this.record(manager, actor, 'SCORING_DRAFT_DISCARDED', saved, {
        number: saved.number,
      });
      return saved;
    });
  }

  // ── Aprobación y activación ────────────────────────────────────────────────

  /**
   * Aprueba y activa un borrador: retira la versión anterior, refleja las
   * reglas y los umbrales en las tablas de 1B y encola el recálculo. Todo o
   * nada en una transacción; el recálculo va después del commit.
   */
  async activate(id: string, actor: JwtAccessPayload): Promise<ScoringVersion> {
    if (!actorHas(actor, ValidPermissions.APPROVE_GROWTH_SCORING)) {
      throw forbidden('Activar una versión exige APPROVE_GROWTH_SCORING');
    }
    const activated = await this.dataSource.transaction(async (manager) => {
      await lock(manager);
      const draft = await this.lockDraft(manager, id);
      const problems = scoringVersionProblems(draft.rules, draft.thresholds);
      if (problems.length) throw invalid(problems.join('. '));
      const settings = await manager.findOneOrFail(GrowthSettings, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      const decision = approvalDecision(
        draft,
        actor,
        settings.allowSuperAdminSelfValidation,
      );
      if (!decision.allowed) {
        throw new CustomError({
          message:
            'Quien propuso o editó el borrador no puede aprobarlo: debe hacerlo otra persona',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GrowthErrorCode.GROWTH_SCORING_SELF_APPROVAL_FORBIDDEN,
        });
      }

      const previous = await activeScoringVersion(manager);
      const now = new Date();
      previous.status = Status.RETIRED;
      previous.retiredAt = now;
      previous.retiredReason = `Reemplazada por la versión ${draft.number}`;
      await manager.save(previous);

      draft.status = Status.ACTIVE;
      draft.approvedByUserId = actor.sub;
      draft.approvedAt = now;
      draft.activatedAt = now;
      draft.selfApprovalException = decision.selfException;
      const saved = await manager.save(draft);

      await this.mirror(manager, saved, actor);

      if (decision.selfException) {
        await this.record(
          manager,
          actor,
          'SCORING_SELF_APPROVAL_EXCEPTION',
          saved,
          { number: saved.number },
        );
      }
      await this.record(manager, actor, 'SCORING_VERSION_RETIRED', previous, {
        number: previous.number,
        replacedBy: saved.number,
      });
      await this.record(manager, actor, 'SCORING_VERSION_ACTIVATED', saved, {
        number: saved.number,
        previous: previous.number,
        thresholds: saved.thresholds,
        rules: saved.rules.length,
      });
      return saved;
    });
    // Después del commit: si Redis falla, el cron de puesta al día lo cubre.
    await this.events?.rescoreAll();
    return activated;
  }

  // ── Recálculo ──────────────────────────────────────────────────────────────

  /**
   * Recalcula los prospectos sin puntaje o con puntaje de otra versión, de a
   * `limit`. Idempotente: un prospecto al día no cambia y el historial solo
   * crece si el puntaje cambió. Lo usan el cron de puesta al día y las
   * pruebas de recuperación.
   */
  async rescorePending(limit = 500): Promise<number> {
    const manager = this.dataSource.manager;
    const active = await activeScoringVersion(manager);
    const pending: Array<{ kind: ScorableKind; id: string }> =
      await manager.query(
        `WITH scorable AS (${SCORABLE_SQL})
         SELECT s.kind, s.id FROM scorable s
           LEFT JOIN growth.prospect_scores ps
             ON (s.kind = 'ORGANIZATION' AND ps.organization_id = s.id)
             OR (s.kind = 'PERSON' AND ps.person_id = s.id)
          WHERE ps.id IS NULL OR ps.version_id IS DISTINCT FROM $1
          ORDER BY s.kind, s.id
          LIMIT $2`,
        [active.id, limit],
      );
    for (const target of pending) {
      await this.scoring.recompute(target.kind, target.id);
    }
    if (pending.length) {
      this.logger.log(`Scoring: ${pending.length} puntajes puestos al día`);
    }
    return pending.length;
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async lockDraft(
    manager: EntityManager,
    id: string,
  ): Promise<ScoringVersion> {
    const version = await manager.findOne(ScoringVersion, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!version) throw notFound();
    if (version.status !== Status.DRAFT) {
      throw new CustomError({
        message: 'Solo un borrador se edita, se descarta o se activa',
        statusCode: HttpStatus.CONFLICT,
        errorCode: GrowthErrorCode.GROWTH_SCORING_VERSION_STATE,
      });
    }
    return version;
  }

  /** Lo que leen `growthScoringRules` y la simulación de 1E-0. */
  private async mirror(
    manager: EntityManager,
    version: ScoringVersion,
    actor: JwtAccessPayload,
  ): Promise<void> {
    for (const r of version.rules) {
      await manager.query(
        `INSERT INTO growth.scoring_rules (key, label, predicate, params, points, applies_to, active, sort_order, updated_by_user_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::text[], $7, $8, $9)
         ON CONFLICT (key) DO UPDATE
           SET label = EXCLUDED.label, predicate = EXCLUDED.predicate, params = EXCLUDED.params,
               points = EXCLUDED.points, applies_to = EXCLUDED.applies_to, active = EXCLUDED.active,
               sort_order = EXCLUDED.sort_order, updated_by_user_id = EXCLUDED.updated_by_user_id,
               updated_at = now()`,
        [
          r.key,
          r.label,
          r.predicate,
          JSON.stringify(r.params ?? {}),
          r.points,
          r.appliesTo,
          r.active,
          r.sortOrder,
          actor.sub,
        ],
      );
    }
    await manager.query(
      `UPDATE growth.scoring_rules SET active = false, updated_by_user_id = $2, updated_at = now()
        WHERE NOT (key = ANY($1::text[])) AND active`,
      [version.rules.map((r) => r.key), actor.sub],
    );
    await manager.query(
      `UPDATE growth.settings
          SET scoring_high_threshold = $1, scoring_medium_threshold = $2,
              scoring_version = scoring_version + 1, updated_at = now(), updated_by_user_id = $3
        WHERE id = 1`,
      [version.thresholds.high, version.thresholds.medium, actor.sub],
    );
  }

  private record(
    manager: EntityManager,
    actor: JwtAccessPayload,
    action: string,
    version: ScoringVersion,
    changes: Record<string, unknown>,
  ): Promise<unknown> {
    return this.activity.record(manager, actor, {
      action,
      entityType: GrowthEntityType.SCORING_VERSION,
      entityId: version.id,
      changes,
    });
  }
}

/** Prospectos que deben tener puntaje (mismo criterio que `scorableIds`). */
const SCORABLE_SQL = `
  SELECT 'ORGANIZATION'::text AS kind, id FROM growth.organizations WHERE deleted_at IS NULL AND merged_into_id IS NULL
  UNION ALL
  SELECT 'PERSON'::text AS kind, id FROM growth.people WHERE deleted_at IS NULL AND merged_into_id IS NULL AND is_independent_admin`;

async function lock(manager: EntityManager): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    VERSIONS_LOCK,
  ]);
}

function notFound(): CustomError {
  return new CustomError({
    message: 'Versión de scoring no encontrada',
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
  });
}

function invalid(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
  });
}

function forbidden(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.FORBIDDEN,
    errorCode: GrowthErrorCode.GROWTH_SCORING_FORBIDDEN,
  });
}
