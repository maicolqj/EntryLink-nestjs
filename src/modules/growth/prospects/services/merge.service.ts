import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthEntityType,
  GrowthIdentifierType,
} from '../../shared/growth.enums';
import { normalizeIdentifier } from '../../shared/identifier-normalizer';
import {
  DuplicateCandidate,
  MergeLog,
} from '../entities/dedupe-scoring.entity';
import { Person } from '../entities/person.entity';
import { ValidatableRecord } from '../entities/validatable-record';
import {
  GrowthContactStatus,
  GrowthDuplicateStatus,
  GrowthMergeSide,
  GrowthProspectKind as K,
  GrowthValidationStatus,
} from '../prospects.enums';
import { GrowthMergeDuplicatesInput } from '../dto/inputs/dedupe-scoring.inputs';
import {
  GrowthMergeFieldOutcome,
  GrowthMergeFieldPreview,
  GrowthMergeMoveCount,
  GrowthMergePreview,
} from '../dto/responses/merge-preview.responses';
import {
  nitCheckDigit,
  normalizeBogotaAddress,
  normalizeOrganizationName,
  normalizePersonName,
  normalizePropertyName,
} from '../shared/prospect-normalizers';
import { ProspectEventsService } from './prospect-events.service';
import {
  PROSPECT_TARGETS,
  ProspectGuardsService,
} from './prospect-guards.service';

/** Campos que se pueden combinar en una fusión, por tipo. */
export const MERGEABLE_FIELDS: Record<K, string[]> = {
  [K.ORGANIZATION]: [
    'legalName',
    'tradeName',
    'nit',
    'website',
    'address',
    'city',
    'locality',
    'estimatedProperties',
    'estimatedUnits',
    'interestSignal',
  ],
  // La base jurídica y la autorización de contacto NO se combinan: el
  // sobreviviente conserva las suyas (y se revoca un contacto autorizado).
  [K.PERSON]: ['fullName', 'isIndependentAdmin', 'interestSignal'],
  [K.PROPERTY]: [
    'name',
    'phType',
    'buildingKind',
    'address',
    'city',
    'locality',
    'neighborhood',
    'estimatedUnits',
    'realEstateRegistration',
    'nit',
    'infoStatus',
  ],
};

/** Campos cuyo cambio obliga a revalidar al sobreviviente. */
const CRITICAL: Record<K, string[]> = {
  [K.ORGANIZATION]: ['legalName', 'nit'],
  [K.PERSON]: ['fullName'],
  [K.PROPERTY]: ['name', 'address'],
};

const EVIDENCE_TYPE: Record<K, GrowthEntityType> = {
  [K.ORGANIZATION]: GrowthEntityType.ORGANIZATION,
  [K.PERSON]: GrowthEntityType.PERSON,
  [K.PROPERTY]: GrowthEntityType.PROPERTY,
};

/**
 * Fusión SIEMPRE manual de un par propuesto. El registro absorbido no se
 * borra: queda DUPLICATE con merged_into_id; sus relaciones, evidencias y
 * asignaciones pasan al sobreviviente; todo queda en merge_log (append-only)
 * y en el registro de actividad.
 */
@Injectable()
export class MergeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly activity: ActivityLogService,
    @Optional() private readonly events?: ProspectEventsService,
  ) {}

  async merge(
    input: GrowthMergeDuplicatesInput,
    actor: JwtAccessPayload,
  ): Promise<MergeLog> {
    const result = await this.dataSource.transaction(async (manager) => {
      const { candidate, kind, mergedId, survivor, merged } =
        await this.loadPair(manager, input, actor, true);

      // ── Valores por campo ─────────────────────────────────────────────────
      const s = survivor as unknown as Record<string, unknown>;
      const m = merged as unknown as Record<string, unknown>;
      const plan = planMergeFields(kind, s, m, input.fieldChoices);
      if (plan.missing.length) {
        throw invalid(
          `Elige qué valor conservar en: ${plan.missing.join(', ')}`,
        );
      }
      const { fieldChoices, fromMerged } = plan;

      const before = { ...s };
      // El NIT es único: se libera en el absorbido antes de copiarlo.
      if (fromMerged.includes('nit')) {
        await manager.query(
          `UPDATE ${PROSPECT_TARGETS[kind].table} SET nit = NULL WHERE id = $1`,
          [mergedId],
        );
      }
      for (const field of fromMerged) s[field] = m[field];
      if (fromMerged.includes('nit')) m.nit = null;
      this.renormalize(kind, s, fromMerged);
      const revalidate = needsRevalidation(
        kind,
        survivor.validationStatus,
        before,
        s,
      );
      if (revalidate) {
        survivor.validationStatus = GrowthValidationStatus.PENDING_REVIEW;
        survivor.validationTakenByUserId = null;
      }
      if (kind === K.PERSON)
        this.revokeContact(
          survivor as Person,
          'Fusión de registros: requiere nueva autorización',
        );
      survivor.updatedByUserId = actor.sub;
      await manager.save(survivor);

      // ── Traslados ──────────────────────────────────────────────────────────
      const moved = await this.moveRelations(
        manager,
        kind,
        mergedId,
        input.survivorId,
        candidate.id,
        actor,
      );

      // ── Absorbido: DUPLICATE + merged_into_id (permitido por el trigger) ──
      if (kind === K.PERSON)
        this.revokeContact(
          merged as Person,
          'Registro absorbido en una fusión',
        );
      merged.mergedIntoId = input.survivorId;
      merged.validationStatus = GrowthValidationStatus.DUPLICATE;
      merged.validationTakenByUserId = null;
      merged.validationNote = input.note.trim();
      merged.updatedByUserId = actor.sub;
      await manager.save(merged);

      candidate.status = GrowthDuplicateStatus.MERGED;
      candidate.resolvedByUserId = actor.sub;
      candidate.resolvedAt = new Date();
      candidate.resolutionNote = input.note.trim();
      await manager.save(candidate);

      const log = await manager.save(
        manager.create(MergeLog, {
          entityType: kind,
          survivorId: input.survivorId,
          mergedId,
          candidateId: candidate.id,
          fieldChoices,
          moved,
          mergedByUserId: actor.sub,
        }),
      );
      const entityType = EVIDENCE_TYPE[kind];
      await this.activity.record(manager, actor, {
        action: 'MERGE_SURVIVOR',
        entityType,
        entityId: input.survivorId,
        changes: {
          mergedId,
          mergeLogId: log.id,
          fields: Object.keys(fieldChoices),
          revalidation: revalidate,
        },
      });
      await this.activity.record(manager, actor, {
        action: 'MERGED_INTO',
        entityType,
        entityId: mergedId,
        changes: { survivorId: input.survivorId, mergeLogId: log.id },
      });
      return { log, kind };
    });
    await this.events?.changed(result.kind, input.survivorId, { dedupe: true });
    return result.log;
  }

  history(kind: K, id: string): Promise<MergeLog[]> {
    return this.dataSource.manager.find(MergeLog, {
      where: [
        { entityType: kind, survivorId: id },
        { entityType: kind, mergedId: id },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Vista previa de una fusión con los datos reales: mismas validaciones del
   * par (`loadPair`), mismo plan de campos (`planMergeFields`), misma regla
   * de revalidación y los traslados contados sobre las mismas tablas
   * (`movesFor`). Transacción READ ONLY: no modifica nada ni registra actividad.
   * Con elecciones incompletas no falla: devuelve `missingChoices`.
   */
  async preview(
    input: Pick<
      GrowthMergeDuplicatesInput,
      'candidateId' | 'survivorId' | 'fieldChoices'
    >,
    actor: JwtAccessPayload,
  ): Promise<GrowthMergePreview> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const { candidate, kind, mergedId, survivor, merged } =
        await this.loadPair(manager, input, actor, false);
      const s = survivor as unknown as Record<string, unknown>;
      const m = merged as unknown as Record<string, unknown>;
      const plan = planMergeFields(kind, s, m, input.fieldChoices ?? []);
      const after = { ...s };
      for (const field of plan.fromMerged) after[field] = m[field];

      const col = PROSPECT_TARGETS[kind].assignmentColumn;
      const [flags]: Array<{
        assignment_closed: boolean;
        management_ended: boolean;
      }> = await manager.query(
        `SELECT
           EXISTS (SELECT 1 FROM growth.prospect_assignments WHERE ${col} = $1 AND ended_at IS NULL)
           AND EXISTS (SELECT 1 FROM growth.prospect_assignments WHERE ${col} = $2 AND ended_at IS NULL) AS assignment_closed,
           $3::boolean
           AND EXISTS (SELECT 1 FROM growth.property_managements WHERE property_id = $1 AND status = 'CURRENT')
           AND EXISTS (SELECT 1 FROM growth.property_managements WHERE property_id = $2 AND status = 'CURRENT') AS management_ended`,
        [mergedId, input.survivorId, kind === K.PROPERTY],
      );
      const authorized = (r: ValidatableRecord) =>
        kind === K.PERSON &&
        (r as Person).contactStatus === GrowthContactStatus.AUTHORIZED;

      return {
        candidateId: candidate.id,
        entityType: kind,
        survivorId: input.survivorId,
        mergedId,
        fields: plan.fields,
        missingChoices: plan.missing,
        ready: plan.missing.length === 0,
        moves: await this.countMoves(manager, kind, mergedId, candidate.id),
        assignmentClosed: flags.assignment_closed,
        managementEnded: flags.management_ended,
        revalidation: needsRevalidation(
          kind,
          survivor.validationStatus,
          s,
          after,
        ),
        survivorContactRevoked: authorized(survivor),
        mergedContactRevoked: authorized(merged),
      };
    });
  }

  /** Par pendiente y sus dos registros vivos, visibles para el actor. */
  private async loadPair(
    manager: EntityManager,
    input: Pick<GrowthMergeDuplicatesInput, 'candidateId' | 'survivorId'>,
    actor: JwtAccessPayload,
    lock: boolean,
  ): Promise<{
    candidate: DuplicateCandidate;
    kind: K;
    mergedId: string;
    survivor: ValidatableRecord;
    merged: ValidatableRecord;
  }> {
    const candidate = await manager.findOne(DuplicateCandidate, {
      where: { id: input.candidateId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!candidate) throw notFound('Posible duplicado no encontrado');
    if (candidate.status !== GrowthDuplicateStatus.PENDING) {
      throw conflict(`El par ya está ${candidate.status}`);
    }
    if (![candidate.leftId, candidate.rightId].includes(input.survivorId)) {
      throw invalid(
        'El sobreviviente debe ser uno de los dos registros del par',
      );
    }
    const kind = candidate.entityType;
    const mergedId =
      input.survivorId === candidate.leftId
        ? candidate.rightId
        : candidate.leftId;
    const survivor = await this.guards.findVisible<ValidatableRecord>(
      manager,
      kind,
      input.survivorId,
      actor,
      lock,
    );
    const merged = await this.guards.findVisible<ValidatableRecord>(
      manager,
      kind,
      mergedId,
      actor,
      lock,
    );
    for (const r of [survivor, merged]) {
      if (r.mergedIntoId || r.deletedAt)
        throw conflict('Uno de los registros ya fue fusionado o descartado');
    }
    return { candidate, kind, mergedId, survivor, merged };
  }

  /** Lo que `moveRelations` trasladaría, contado sobre las mismas tablas. */
  private async countMoves(
    manager: EntityManager,
    kind: K,
    from: string,
    candidateId: string,
  ): Promise<GrowthMergeMoveCount[]> {
    const out: GrowthMergeMoveCount[] = [];
    for (const move of movesFor(kind)) {
      const [{ n }]: Array<{ n: number }> = await manager.query(
        `SELECT count(*)::int AS n FROM ${move.table} WHERE ${move.column} = $1${move.extra ? ` AND ${move.extra}` : ''}`,
        [from, ...(move.params ?? [])],
      );
      out.push({ key: move.key, count: n });
    }
    const [{ n }]: Array<{ n: number }> = await manager.query(
      `SELECT count(*)::int AS n FROM growth.duplicate_candidates
        WHERE entity_type = $2 AND status = 'PENDING' AND (left_id = $1 OR right_id = $1) AND id <> $3`,
      [from, kind, candidateId],
    );
    out.push({ key: 'candidatesClosed', count: n });
    return out;
  }

  /**
   * Mueve todo lo que cuelga del absorbido al sobreviviente. Donde la base
   * exige un único vigente (asignación, administración), el vigente del
   * absorbido se cierra antes de moverlo, y queda como historial.
   */
  private async moveRelations(
    manager: EntityManager,
    kind: K,
    from: string,
    to: string,
    candidateId: string,
    actor: JwtAccessPayload,
  ): Promise<Record<string, number>> {
    const moved: Record<string, number> = {};
    const run = async (key: string, sql: string, params: unknown[]) => {
      const result: [unknown, number] = await manager.query(sql, params);
      const count = result[1];
      if (count) moved[key] = (moved[key] ?? 0) + count;
    };
    const col = PROSPECT_TARGETS[kind].assignmentColumn;

    // Asignación: si ambos tienen responsable vigente, se cierra la del absorbido.
    await manager.query(
      `UPDATE growth.prospect_assignments a SET ended_at = now(), ended_by_user_id = $3
        WHERE a.${col} = $1 AND a.ended_at IS NULL
          AND EXISTS (SELECT 1 FROM growth.prospect_assignments b WHERE b.${col} = $2 AND b.ended_at IS NULL)`,
      [from, to, actor.sub],
    );
    if (kind === K.PROPERTY) {
      // Una sola administración vigente: la del absorbido pasa a historial.
      await manager.query(
        `UPDATE growth.property_managements m
            SET status = 'PAST', ended_on = greatest(coalesce(m.started_on, current_date), current_date),
                updated_by_user_id = $3, updated_at = now()
          WHERE m.property_id = $1 AND m.status = 'CURRENT'
            AND EXISTS (SELECT 1 FROM growth.property_managements o WHERE o.property_id = $2 AND o.status = 'CURRENT')`,
        [from, to, actor.sub],
      );
    }
    for (const move of movesFor(kind)) {
      await run(
        move.key,
        `UPDATE ${move.table} SET ${move.column} = $2 WHERE ${move.column} = $1${move.extra ? ` AND ${move.extra.replace(/\$(\d+)/g, (_, d: string) => `$${Number(d) + 1}`)}` : ''}`,
        [from, to, ...(move.params ?? [])],
      );
    }
    if (kind !== K.PROPERTY) {
      await manager.query(
        `DELETE FROM growth.prospect_scores WHERE ${col} = $1`,
        [from],
      );
    }

    // Otros pares pendientes que involucraban al absorbido ya no aplican.
    await run(
      'candidatesClosed',
      `UPDATE growth.duplicate_candidates
          SET status = 'DISMISSED', resolved_at = now(), resolved_by_user_id = $3,
              resolution_note = 'Registro absorbido en otra fusión', updated_at = now()
        WHERE entity_type = $2 AND status = 'PENDING' AND (left_id = $1 OR right_id = $1) AND id <> $4`,
      [from, kind, actor.sub, candidateId],
    );
    return moved;
  }

  private renormalize(
    kind: K,
    s: Record<string, unknown>,
    fields: string[],
  ): void {
    const has = (f: string) => fields.includes(f);
    // Los campos combinables de texto siempre son string (ver MERGEABLE_FIELDS).
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (kind === K.ORGANIZATION) {
      if (has('legalName'))
        s.nameNormalized = normalizeOrganizationName(str(s.legalName));
      if (has('nit') && s.nit) s.nitCheckDigit = nitCheckDigit(str(s.nit));
      if (has('website') && s.website) {
        s.domain = normalizeIdentifier(
          GrowthIdentifierType.DOMAIN,
          str(s.website),
        );
      }
    }
    if (kind === K.PERSON && has('fullName'))
      s.nameNormalized = normalizePersonName(str(s.fullName));
    if (kind === K.PROPERTY && has('name'))
      s.nameNormalized = normalizePropertyName(str(s.name));
    if (has('address') && s.address)
      s.addressNormalized = normalizeBogotaAddress(str(s.address));
  }

  /** Criterio conservador: tras una fusión el contacto se vuelve a autorizar. */
  private revokeContact(person: Person, reason: string): void {
    if (person.contactStatus === GrowthContactStatus.AUTHORIZED) {
      person.contactStatus = GrowthContactStatus.REVOKED;
      person.contactStatusReason = reason;
    }
  }
}

function notFound(message: string) {
  return new CustomError({
    message,
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
  });
}
function conflict(message: string) {
  return new CustomError({
    message,
    statusCode: HttpStatus.CONFLICT,
    errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
  });
}
function invalid(message: string) {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
  });
}

interface MoveSpec {
  /** Clave en `merge_log.moved` y en la vista previa. */
  key: string;
  table: string;
  /** Columna que apunta al registro y se reasigna al sobreviviente. */
  column: string;
  /** Condición adicional; sus parámetros empiezan en $2. */
  extra?: string;
  params?: unknown[];
}

/**
 * Qué se traslada al sobreviviente, por tipo. Lo usan la fusión (UPDATE) y
 * la vista previa (count): una sola lista de tablas.
 */
export function movesFor(kind: K): MoveSpec[] {
  const col = PROSPECT_TARGETS[kind].assignmentColumn;
  const common: MoveSpec[] = [
    { key: 'assignments', table: 'growth.prospect_assignments', column: col },
    {
      key: 'evidences',
      table: 'growth.evidences',
      column: 'entity_id',
      extra: 'entity_type = $2',
      params: [EVIDENCE_TYPE[kind]],
    },
  ];
  if (kind === K.ORGANIZATION) {
    return [
      ...common,
      {
        key: 'channels',
        table: 'growth.organization_channels',
        column: 'organization_id',
      },
      {
        key: 'employments',
        table: 'growth.employments',
        column: 'organization_id',
      },
      {
        key: 'managements',
        table: 'growth.property_managements',
        column: 'organization_id',
      },
    ];
  }
  if (kind === K.PERSON) {
    return [
      ...common,
      { key: 'channels', table: 'growth.person_channels', column: 'person_id' },
      { key: 'employments', table: 'growth.employments', column: 'person_id' },
      {
        key: 'managements',
        table: 'growth.property_managements',
        column: 'person_id',
      },
      {
        key: 'responsibleOf',
        table: 'growth.property_managements',
        column: 'responsible_person_id',
      },
    ];
  }
  return [
    ...common,
    {
      key: 'managements',
      table: 'growth.property_managements',
      column: 'property_id',
    },
  ];
}

export interface MergeFieldPlan {
  fields: GrowthMergeFieldPreview[];
  /** Campo → SURVIVOR | MERGED | MERGED_AUTO (lo que queda en merge_log). */
  fieldChoices: Record<string, string>;
  fromMerged: string[];
  /** Campos en conflicto sin elección. */
  missing: string[];
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

/**
 * Plan de campos de una fusión: iguales, solo en el sobreviviente, se toma
 * del absorbido porque el sobreviviente está vacío, o conflicto que exige
 * elegir lado. La fusión y la vista previa usan esta misma función.
 */
export function planMergeFields(
  kind: K,
  survivor: Record<string, unknown>,
  merged: Record<string, unknown>,
  choicesInput: Array<{ field: string; side: GrowthMergeSide }>,
): MergeFieldPlan {
  const choices = new Map(choicesInput.map((c) => [c.field, c.side]));
  for (const field of choices.keys()) {
    if (!MERGEABLE_FIELDS[kind].includes(field))
      throw invalid(`El campo ${field} no se combina en una fusión`);
  }
  const plan: MergeFieldPlan = {
    fields: [],
    fieldChoices: {},
    fromMerged: [],
    missing: [],
  };
  for (const field of MERGEABLE_FIELDS[kind]) {
    const sv = survivor[field];
    const mv = merged[field];
    const row: GrowthMergeFieldPreview = {
      field,
      survivorValue: sv ?? null,
      mergedValue: mv ?? null,
      outcome: GrowthMergeFieldOutcome.SAME,
      chosenSide: null,
      resultValue: sv ?? null,
    };
    plan.fields.push(row);
    if (isEmpty(mv) || JSON.stringify(sv) === JSON.stringify(mv)) {
      row.outcome =
        isEmpty(mv) && !isEmpty(sv)
          ? GrowthMergeFieldOutcome.SURVIVOR_ONLY
          : GrowthMergeFieldOutcome.SAME;
      continue;
    }
    if (isEmpty(sv)) {
      row.outcome = GrowthMergeFieldOutcome.FROM_MERGED;
      row.resultValue = mv;
      plan.fieldChoices[field] = 'MERGED_AUTO';
      plan.fromMerged.push(field);
      continue;
    }
    row.outcome = GrowthMergeFieldOutcome.CONFLICT;
    const side = choices.get(field);
    if (!side) {
      row.resultValue = null;
      plan.missing.push(field);
      continue;
    }
    row.chosenSide = side;
    plan.fieldChoices[field] = side;
    if (side === GrowthMergeSide.MERGED) {
      row.resultValue = mv;
      plan.fromMerged.push(field);
    }
  }
  return plan;
}

/** Un VALIDATED vuelve a revisión si cambia un campo crítico. */
export function needsRevalidation(
  kind: K,
  status: GrowthValidationStatus,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return (
    status === GrowthValidationStatus.VALIDATED &&
    CRITICAL[kind].some(
      (f) => JSON.stringify(after[f]) !== JSON.stringify(before[f]),
    )
  );
}
