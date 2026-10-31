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
      const candidate = await manager.findOne(DuplicateCandidate, {
        where: { id: input.candidateId },
        lock: { mode: 'pessimistic_write' },
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
        true,
      );
      const merged = await this.guards.findVisible<ValidatableRecord>(
        manager,
        kind,
        mergedId,
        actor,
        true,
      );
      for (const r of [survivor, merged]) {
        if (r.mergedIntoId || r.deletedAt)
          throw conflict('Uno de los registros ya fue fusionado o descartado');
      }

      // ── Valores por campo ─────────────────────────────────────────────────
      const choices = new Map(input.fieldChoices.map((c) => [c.field, c.side]));
      for (const field of choices.keys()) {
        if (!MERGEABLE_FIELDS[kind].includes(field))
          throw invalid(`El campo ${field} no se combina en una fusión`);
      }
      const s = survivor as unknown as Record<string, unknown>;
      const m = merged as unknown as Record<string, unknown>;
      const fieldChoices: Record<string, string> = {};
      const missing: string[] = [];
      const fromMerged: string[] = [];
      for (const field of MERGEABLE_FIELDS[kind]) {
        const sv = s[field];
        const mv = m[field];
        const sEmpty = sv === null || sv === undefined || sv === '';
        const mEmpty = mv === null || mv === undefined || mv === '';
        if (mEmpty || JSON.stringify(sv) === JSON.stringify(mv)) continue;
        if (sEmpty) {
          fieldChoices[field] = 'MERGED_AUTO';
          fromMerged.push(field);
          continue;
        }
        const side = choices.get(field);
        if (!side) {
          missing.push(field);
          continue;
        }
        fieldChoices[field] = side;
        if (side === GrowthMergeSide.MERGED) fromMerged.push(field);
      }
      if (missing.length) {
        throw invalid(`Elige qué valor conservar en: ${missing.join(', ')}`);
      }

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
      const revalidate =
        survivor.validationStatus === GrowthValidationStatus.VALIDATED &&
        CRITICAL[kind].some(
          (f) => JSON.stringify(s[f]) !== JSON.stringify(before[f]),
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
   * Mueve todo lo que cuelga del absorbido al sobreviviente. Donde la base
   * exige un único vigente (asignación, administración), el vigente del
   * absorbido se cierra antes de moverlo, y queda como historial.
   */
  private async moveRelations(
    manager: EntityManager,
    kind: K,
    from: string,
    to: string,
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
    await run(
      'assignments',
      `UPDATE growth.prospect_assignments SET ${col} = $2 WHERE ${col} = $1`,
      [from, to],
    );
    await run(
      'evidences',
      `UPDATE growth.evidences SET entity_id = $2 WHERE entity_type = $3 AND entity_id = $1`,
      [from, to, EVIDENCE_TYPE[kind]],
    );

    if (kind === K.ORGANIZATION) {
      await run(
        'channels',
        `UPDATE growth.organization_channels SET organization_id = $2 WHERE organization_id = $1`,
        [from, to],
      );
      await run(
        'employments',
        `UPDATE growth.employments SET organization_id = $2 WHERE organization_id = $1`,
        [from, to],
      );
      await run(
        'managements',
        `UPDATE growth.property_managements SET organization_id = $2 WHERE organization_id = $1`,
        [from, to],
      );
      await manager.query(
        `DELETE FROM growth.prospect_scores WHERE organization_id = $1`,
        [from],
      );
    } else if (kind === K.PERSON) {
      await run(
        'channels',
        `UPDATE growth.person_channels SET person_id = $2 WHERE person_id = $1`,
        [from, to],
      );
      await run(
        'employments',
        `UPDATE growth.employments SET person_id = $2 WHERE person_id = $1`,
        [from, to],
      );
      await run(
        'managements',
        `UPDATE growth.property_managements SET person_id = $2 WHERE person_id = $1`,
        [from, to],
      );
      await run(
        'responsibleOf',
        `UPDATE growth.property_managements SET responsible_person_id = $2 WHERE responsible_person_id = $1`,
        [from, to],
      );
      await manager.query(
        `DELETE FROM growth.prospect_scores WHERE person_id = $1`,
        [from],
      );
    } else {
      // Una sola administración vigente: la del absorbido pasa a historial.
      await manager.query(
        `UPDATE growth.property_managements m
            SET status = 'PAST', ended_on = greatest(coalesce(m.started_on, current_date), current_date),
                updated_by_user_id = $3, updated_at = now()
          WHERE m.property_id = $1 AND m.status = 'CURRENT'
            AND EXISTS (SELECT 1 FROM growth.property_managements o WHERE o.property_id = $2 AND o.status = 'CURRENT')`,
        [from, to, actor.sub],
      );
      await run(
        'managements',
        `UPDATE growth.property_managements SET property_id = $2 WHERE property_id = $1`,
        [from, to],
      );
    }

    // Otros pares pendientes que involucraban al absorbido ya no aplican.
    await run(
      'candidatesClosed',
      `UPDATE growth.duplicate_candidates
          SET status = 'DISMISSED', resolved_at = now(), resolved_by_user_id = $3,
              resolution_note = 'Registro absorbido en otra fusión', updated_at = now()
        WHERE entity_type = $2 AND status = 'PENDING' AND (left_id = $1 OR right_id = $1)`,
      [from, kind, actor.sub],
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
