import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import { DuplicateCandidate } from '../entities/dedupe-scoring.entity';
import {
  GrowthDuplicateStatus,
  GrowthProspectKind as K,
} from '../prospects.enums';
import { GrowthDuplicateFilterInput } from '../dto/inputs/dedupe-scoring.inputs';
import { paginate } from '../dto/responses/prospect.responses';
import { GENERIC_EMAIL_DOMAINS, nameSimilarity } from '../shared/similarity';
import { PROSPECT_TARGETS } from './prospect-guards.service';

/** Pesos por señal (plan §17). Puntaje = suma con tope 100. */
export const SIGNAL_WEIGHTS = {
  NIT: 100,
  REGISTRATION: 100,
  EMAIL: 90,
  DOMAIN: 80,
  PHONE: 70,
  ADDRESS: 60,
  NAME_STRONG: 50,
  NAME_WEAK: 30,
} as const;

export const CANDIDATE_THRESHOLD = 50;
const NAME_STRONG = 0.85;
const NAME_WEAK = 0.7;

type Signal =
  'NIT' | 'REGISTRATION' | 'EMAIL' | 'DOMAIN' | 'PHONE' | 'ADDRESS' | 'NAME';

/**
 * Detección de posibles duplicados. Solo PROPONE pares para revisión
 * humana: nunca fusiona. Un par descartado o fusionado no se reabre.
 */
@Injectable()
export class DedupeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
  ) {}

  /** Busca duplicados de un registro y crea o actualiza candidatos PENDING. */
  async scan(kind: K, id: string): Promise<number> {
    const manager = this.dataSource.manager;
    const table = PROSPECT_TARGETS[kind].table;
    const [self]: Array<Record<string, string | null>> = await manager.query(
      `SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [id],
    );
    if (!self) return 0;

    const hits = new Map<string, { signals: Set<Signal>; score: number }>();
    const hit = (otherId: string, signal: Signal, weight: number) => {
      if (otherId === id) return;
      const h = hits.get(otherId) ?? { signals: new Set<Signal>(), score: 0 };
      if (!h.signals.has(signal)) {
        h.signals.add(signal);
        h.score += weight;
      }
      hits.set(otherId, h);
    };
    const others = async (
      sql: string,
      params: unknown[],
      signal: Signal,
      weight: number,
    ) => {
      const rows: Array<{ id: string }> = await manager.query(sql, params);
      rows.forEach((r) => hit(r.id, signal, weight));
    };
    const alive = `deleted_at IS NULL AND merged_into_id IS NULL AND id <> $1`;

    if (kind === K.ORGANIZATION || kind === K.PROPERTY) {
      if (self.nit) {
        await others(
          `SELECT id FROM ${table} WHERE ${alive} AND nit = $2`,
          [id, self.nit],
          'NIT',
          SIGNAL_WEIGHTS.NIT,
        );
      }
      if (self.address_normalized) {
        await others(
          `SELECT id FROM ${table} WHERE ${alive} AND address_normalized = $2`,
          [id, self.address_normalized],
          'ADDRESS',
          SIGNAL_WEIGHTS.ADDRESS,
        );
      }
    }
    if (kind === K.PROPERTY && self.real_estate_registration) {
      await others(
        `SELECT id FROM growth.properties WHERE ${alive} AND real_estate_registration = $2`,
        [id, self.real_estate_registration],
        'REGISTRATION',
        SIGNAL_WEIGHTS.REGISTRATION,
      );
    }
    if (kind === K.ORGANIZATION) {
      await this.channelSignals(
        manager,
        'organization_channels',
        'organization_id',
        'organizations',
        id,
        self.domain,
        hit,
      );
    }
    if (kind === K.PERSON) {
      await this.channelSignals(
        manager,
        'person_channels',
        'person_id',
        'people',
        id,
        null,
        hit,
      );
    }

    await this.nameSignals(manager, kind, id, self, hit);

    let created = 0;
    for (const [otherId, h] of hits) {
      const score = Math.min(100, h.score);
      if (score < CANDIDATE_THRESHOLD) continue;
      const [left, right] = [id, otherId].sort();
      await manager.query(
        `INSERT INTO growth.duplicate_candidates (entity_type, left_id, right_id, matched_on, score)
         VALUES ($1, $2, $3, $4::text[], $5)
         ON CONFLICT (entity_type, left_id, right_id) DO UPDATE
           SET matched_on = EXCLUDED.matched_on, score = EXCLUDED.score, updated_at = now()
           WHERE growth.duplicate_candidates.status = 'PENDING'`,
        [kind, left, right, [...h.signals].sort(), score],
      );
      created++;
    }
    return created;
  }

  async list(
    filter: GrowthDuplicateFilterInput = {},
    pagination: PaginationInput = { page: 1, limit: 25 },
  ) {
    const qb = this.dataSource.manager
      .createQueryBuilder(DuplicateCandidate, 'd')
      .where('d.status = :status', {
        status: filter.status ?? GrowthDuplicateStatus.PENDING,
      })
      .orderBy('d.score', 'DESC')
      .addOrderBy('d.createdAt', 'ASC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);
    if (filter.entityType)
      qb.andWhere('d.entity_type = :type', { type: filter.entityType });
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, pagination);
  }

  async dismiss(
    id: string,
    note: string,
    actor: JwtAccessPayload,
  ): Promise<DuplicateCandidate> {
    if (note.trim().length < 5) {
      throw new CustomError({
        message: 'Descartar un posible duplicado exige un motivo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
      });
    }
    return this.dataSource.transaction(async (manager) => {
      const candidate = await manager.findOne(DuplicateCandidate, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!candidate) {
        throw new CustomError({
          message: 'Posible duplicado no encontrado',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
        });
      }
      if (candidate.status !== GrowthDuplicateStatus.PENDING) {
        throw new CustomError({
          message: `El par ya está ${candidate.status}`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
        });
      }
      candidate.status = GrowthDuplicateStatus.DISMISSED;
      candidate.resolvedByUserId = actor.sub;
      candidate.resolvedAt = new Date();
      candidate.resolutionNote = note.trim();
      const saved = await manager.save(candidate);
      await this.activity.record(manager, actor, {
        action: 'DUPLICATE_DISMISSED',
        entityType: GrowthEntityType.DUPLICATE_CANDIDATE,
        entityId: id,
        changes: {
          entityType: candidate.entityType,
          leftId: candidate.leftId,
          rightId: candidate.rightId,
          note: note.trim(),
        },
      });
      return saved;
    });
  }

  /** Correos, teléfonos y (empresas) dominio, compartidos con otro registro. */
  private async channelSignals(
    manager: EntityManager,
    channelTable: string,
    ownerColumn: string,
    ownerTable: string,
    id: string,
    domain: string | null,
    hit: (otherId: string, signal: Signal, weight: number) => void,
  ): Promise<void> {
    const rows: Array<{ other: string; kind: string }> = await manager.query(
      `SELECT DISTINCT o.${ownerColumn} AS other, o.kind
         FROM growth.${channelTable} mine
         JOIN growth.${channelTable} o ON o.kind = mine.kind AND o.value_normalized = mine.value_normalized
         JOIN growth.${ownerTable} t ON t.id = o.${ownerColumn}
        WHERE mine.${ownerColumn} = $1 AND o.${ownerColumn} <> $1
          AND mine.deleted_at IS NULL AND o.deleted_at IS NULL
          AND mine.kind IN ('EMAIL', 'PHONE', 'WEBSITE')
          AND t.deleted_at IS NULL AND t.merged_into_id IS NULL`,
      [id],
    );
    for (const r of rows) {
      if (r.kind === 'EMAIL') hit(r.other, 'EMAIL', SIGNAL_WEIGHTS.EMAIL);
      if (r.kind === 'PHONE') hit(r.other, 'PHONE', SIGNAL_WEIGHTS.PHONE);
      if (r.kind === 'WEBSITE') hit(r.other, 'DOMAIN', SIGNAL_WEIGHTS.DOMAIN);
    }
    if (domain && !GENERIC_EMAIL_DOMAINS.has(domain)) {
      const same: Array<{ id: string }> = await manager.query(
        `SELECT id FROM growth.organizations
          WHERE deleted_at IS NULL AND merged_into_id IS NULL AND id <> $1 AND domain = $2`,
        [id, domain],
      );
      same.forEach((r) => hit(r.id, 'DOMAIN', SIGNAL_WEIGHTS.DOMAIN));
    }
  }

  /**
   * Nombres parecidos. Copropiedades: misma localidad (o misma ciudad si
   * falta). Personas: solo si comparten empresa o copropiedad, para no
   * proponer homónimos.
   */
  private async nameSignals(
    manager: EntityManager,
    kind: K,
    id: string,
    self: Record<string, string | null>,
    hit: (otherId: string, signal: Signal, weight: number) => void,
  ): Promise<void> {
    const name = self.name_normalized;
    if (!name) return;
    const table = PROSPECT_TARGETS[kind].table;
    let sql = `SELECT id, name_normalized FROM ${table} WHERE deleted_at IS NULL AND merged_into_id IS NULL AND id <> $1`;
    const params: unknown[] = [id];
    if (kind === K.PROPERTY) {
      if (self.locality) {
        sql += ` AND (locality = $2 OR locality IS NULL)`;
        params.push(self.locality);
      } else {
        sql += ` AND city = $2`;
        params.push(self.city);
      }
    }
    const rows: Array<{ id: string; name_normalized: string }> =
      await manager.query(sql, params);
    for (const r of rows) {
      const sim = nameSimilarity(name, r.name_normalized);
      if (sim < NAME_WEAK) continue;
      if (kind === K.PERSON && !(await this.shareContext(manager, id, r.id)))
        continue;
      hit(
        r.id,
        'NAME',
        sim >= NAME_STRONG
          ? SIGNAL_WEIGHTS.NAME_STRONG
          : SIGNAL_WEIGHTS.NAME_WEAK,
      );
    }
  }

  private async shareContext(
    manager: EntityManager,
    a: string,
    b: string,
  ): Promise<boolean> {
    const [row]: Array<{ shared: boolean }> = await manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM growth.employments x JOIN growth.employments y ON y.organization_id = x.organization_id
          WHERE x.person_id = $1 AND y.person_id = $2
         UNION ALL
         SELECT 1 FROM growth.property_managements x JOIN growth.property_managements y ON y.property_id = x.property_id
          WHERE (x.person_id = $1 OR x.responsible_person_id = $1)
            AND (y.person_id = $2 OR y.responsible_person_id = $2)
       ) AS shared`,
      [a, b],
    );
    return row.shared;
  }
}
