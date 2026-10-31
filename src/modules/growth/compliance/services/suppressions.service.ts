import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthHashService,
  VersionedHash,
} from '../../shared/growth-hash.service';
import {
  GrowthEntityType,
  GrowthIdentifierType,
  GrowthSuppressionReason,
  GrowthSuppressionScope,
  GrowthSuppressionStatus,
} from '../../shared/growth.enums';
import { Suppression } from '../entities/suppression.entity';
import { SuppressionHash } from '../entities/suppression-hash.entity';
import {
  GrowthAddSuppressionInput,
  GrowthCheckSuppressionInput,
  GrowthLiftSuppressionInput,
  GrowthSuppressionFilterInput,
} from '../dto/inputs/suppression.inputs';
import {
  GrowthSuppressionKeyStatus,
  PaginatedGrowthSuppressionsResponse,
} from '../dto/responses/suppression.responses';

/**
 * Lista de exclusión comercial.
 *
 * Reglas que no se pueden saltar por otro camino:
 *  - No hay borrado: ni método aquí ni en la base (trigger).
 *  - Ninguna solicitud del titular levanta una exclusión; solo `lift`, con
 *    permiso LIFT_GROWTH_SUPPRESSIONS, fundamento jurídico y soporte.
 *  - Si alguna exclusión activa quedó sin hash en las llaves configuradas, la
 *    consulta FALLA en vez de responder "no excluido" (falla cerrada).
 */
@Injectable()
export class SuppressionsService implements OnModuleInit {
  private readonly logger = new Logger(SuppressionsService.name);
  private uncovered: number | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hashes: GrowthHashService,
    private readonly activity: ActivityLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refreshCoverage();
    } catch (error) {
      this.uncovered = null;
      this.logger.error(
        `No se pudo verificar el llavero HMAC: ${String(error)}`,
      );
    }
  }

  /** true = el dato está excluido y NO se debe contactar por ese canal. */
  async isSuppressed(input: GrowthCheckSuppressionInput): Promise<boolean> {
    await this.assertCoverage();
    const candidates = this.hashes.hashAll(input.identifierType, input.value);
    const matches = await this.findActiveMatches(
      this.dataSource.manager,
      input.identifierType,
      candidates,
    );
    const blocking = matches.filter(
      (m) =>
        !input.channel ||
        m.scope === GrowthSuppressionScope.ALL_CHANNELS ||
        m.scope === input.channel,
    );

    // Re-hash oportunista: el dato en claro está aquí, así que las exclusiones
    // que solo tenían hash con una llave vieja reciben el de la llave activa.
    const active = this.hashes.hashActive(input.identifierType, input.value);
    for (const m of matches.filter(
      (x) => !x.versions.includes(active.keyVersion),
    )) {
      await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(SuppressionHash)
        .values({
          suppressionId: m.id,
          identifierType: input.identifierType,
          keyVersion: active.keyVersion,
          identifierHash: active.hash,
        })
        .orIgnore()
        .execute();
    }

    return blocking.length > 0;
  }

  async add(
    input: GrowthAddSuppressionInput,
    actor: JwtAccessPayload,
  ): Promise<Suppression> {
    await this.assertCoverage();
    const candidates = this.hashes.hashAll(input.identifierType, input.value);
    const active = this.hashes.hashActive(input.identifierType, input.value);
    return this.dataSource.transaction((manager) =>
      this.addHashed(manager, actor, {
        identifierType: input.identifierType,
        candidates,
        writeHash: active,
        scope: input.scope,
        reason: input.reason,
      }),
    );
  }

  /**
   * Alta a partir de un hash ya calculado (solicitudes de titulares). Usa el
   * EntityManager del llamador para quedar en su misma transacción.
   */
  async addHashed(
    manager: EntityManager,
    actor: JwtAccessPayload,
    data: {
      identifierType: GrowthIdentifierType;
      candidates: VersionedHash[];
      writeHash: VersionedHash;
      scope: GrowthSuppressionScope;
      reason: GrowthSuppressionReason;
      sourceRequestId?: string;
    },
  ): Promise<Suppression> {
    // Serializa altas concurrentes del mismo dato.
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `growth-suppression:${data.identifierType}:${data.writeHash.keyVersion}:${data.writeHash.hash}`,
    ]);

    const existing = (
      await this.findActiveMatches(
        manager,
        data.identifierType,
        data.candidates,
      )
    ).find(
      (m) =>
        m.scope === GrowthSuppressionScope.ALL_CHANNELS ||
        m.scope === data.scope,
    );
    if (existing) {
      return manager.findOneOrFail(Suppression, { where: { id: existing.id } });
    }

    const suppression = await manager.save(
      manager.create(Suppression, {
        identifierType: data.identifierType,
        scope: data.scope,
        reason: data.reason,
        sourceRequestId: data.sourceRequestId ?? null,
        status: GrowthSuppressionStatus.ACTIVE,
        createdByUserId: actor.entityType === 'user' ? actor.sub : null,
      }),
    );
    await manager.insert(SuppressionHash, {
      suppressionId: suppression.id,
      identifierType: data.identifierType,
      keyVersion: data.writeHash.keyVersion,
      identifierHash: data.writeHash.hash,
    });
    await this.activity.record(manager, actor, {
      action: 'SUPPRESSION_ADDED',
      entityType: GrowthEntityType.SUPPRESSION,
      entityId: suppression.id,
      changes: {
        identifierType: data.identifierType,
        scope: data.scope,
        reason: data.reason,
        sourceRequestId: data.sourceRequestId ?? null,
      },
    });
    return suppression;
  }

  async lift(
    id: string,
    input: GrowthLiftSuppressionInput,
    actor: JwtAccessPayload,
  ): Promise<Suppression> {
    return this.dataSource.transaction(async (manager) => {
      const suppression = await manager.findOne(Suppression, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!suppression) {
        throw new CustomError({
          message: 'Exclusión no encontrada',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
        });
      }
      if (suppression.status !== GrowthSuppressionStatus.ACTIVE) {
        throw new CustomError({
          message: 'La exclusión ya fue levantada',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_SUPPRESSION_ALREADY_LIFTED,
        });
      }

      // UPDATE explícito de solo estos campos: el trigger rechaza cualquier otro.
      await manager.update(Suppression, id, {
        status: GrowthSuppressionStatus.LIFTED,
        liftedAt: new Date(),
        liftedByUserId: actor.sub,
        liftLegalBasis: input.legalBasis.trim(),
        liftEvidenceReference: input.evidenceReference.trim(),
      });
      await this.activity.record(manager, actor, {
        action: 'SUPPRESSION_LIFTED',
        entityType: GrowthEntityType.SUPPRESSION,
        entityId: id,
        changes: {
          status: { from: 'ACTIVE', to: 'LIFTED' },
          legalBasis: input.legalBasis.trim(),
          evidenceReference: input.evidenceReference.trim(),
        },
      });
      return manager.findOneOrFail(Suppression, { where: { id } });
    });
  }

  async list(
    filter: GrowthSuppressionFilterInput = {},
    pagination: PaginationInput = { page: 1, limit: 25 },
  ): Promise<PaginatedGrowthSuppressionsResponse> {
    const where: Partial<Suppression> = {};
    if (filter.status) where.status = filter.status;
    if (filter.identifierType) where.identifierType = filter.identifierType;
    const [items, totalItems] = await this.dataSource.manager.findAndCount(
      Suppression,
      {
        where,
        order: { createdAt: 'DESC' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      },
    );
    const totalPages = Math.ceil(totalItems / pagination.limit);
    return {
      items,
      pagination: {
        currentPage: pagination.page,
        itemsPerPage: pagination.limit,
        totalItems,
        totalPages,
        hasNextPage: pagination.page < totalPages,
        hasPreviousPage: pagination.page > 1,
      },
    };
  }

  async keyStatus(): Promise<GrowthSuppressionKeyStatus> {
    const configured = this.hashes.versions;
    const active = this.hashes.activeVersion;
    const [row]: Array<{
      active_suppressions: number;
      missing_active: number;
      uncovered: number;
    }> = await this.dataSource.query(
      `SELECT count(*)::int AS active_suppressions,
              count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM growth.suppression_hashes h
                 WHERE h.suppression_id = s.id AND h.key_version = $1))::int AS missing_active,
              count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM growth.suppression_hashes h
                 WHERE h.suppression_id = s.id AND h.key_version = ANY($2::smallint[])))::int AS uncovered
         FROM growth.suppressions s
        WHERE s.status = 'ACTIVE'`,
      [active, configured],
    );

    // Una versión vieja se puede retirar si ninguna exclusión activa depende
    // SOLO de ella (o de ella y otras que tampoco estén configuradas).
    const retirableVersions: number[] = [];
    for (const v of configured.filter((x) => x !== active)) {
      const others = configured.filter((x) => x !== v);
      const [dep]: Array<{ n: number }> = await this.dataSource.query(
        `SELECT count(*)::int AS n
           FROM growth.suppressions s
          WHERE s.status = 'ACTIVE'
            AND NOT EXISTS (SELECT 1 FROM growth.suppression_hashes h
                             WHERE h.suppression_id = s.id AND h.key_version = ANY($1::smallint[]))`,
        [others],
      );
      if (dep.n === 0) retirableVersions.push(v);
    }

    this.uncovered = row.uncovered;
    return {
      activeVersion: active,
      configuredVersions: configured,
      activeSuppressions: row.active_suppressions,
      missingActiveVersion: row.missing_active,
      uncovered: row.uncovered,
      retirableVersions,
    };
  }

  private async refreshCoverage(): Promise<void> {
    const status = await this.keyStatus();
    if (status.uncovered > 0) {
      this.logger.error(
        `${status.uncovered} exclusión(es) activa(s) sin hash en las llaves configuradas: ` +
          'la consulta de exclusiones queda bloqueada hasta restaurar la llave retirada.',
      );
    }
  }

  private async assertCoverage(): Promise<void> {
    if (this.uncovered === null) await this.refreshCoverage();
    if (this.uncovered !== 0) {
      throw new CustomError({
        message:
          'La lista de exclusión no se puede verificar con las llaves configuradas',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: GrowthErrorCode.GROWTH_HMAC_MISCONFIGURED,
      });
    }
  }

  private async findActiveMatches(
    manager: EntityManager,
    identifierType: GrowthIdentifierType,
    candidates: VersionedHash[],
  ): Promise<
    Array<{ id: string; scope: GrowthSuppressionScope; versions: number[] }>
  > {
    if (!candidates.length) return [];
    const params: unknown[] = [identifierType];
    const pairs = candidates.map((c) => {
      params.push(c.keyVersion, c.hash);
      return `($${params.length - 1}::smallint, $${params.length}::char(64))`;
    });
    const rows: Array<{
      id: string;
      scope: GrowthSuppressionScope;
      versions: number[];
    }> = await manager.query(
      `SELECT s.id, s.scope,
                (SELECT array_agg(h2.key_version::int) FROM growth.suppression_hashes h2
                  WHERE h2.suppression_id = s.id) AS versions
           FROM growth.suppressions s
          WHERE s.status = 'ACTIVE'
            AND s.identifier_type = $1
            AND EXISTS (
              SELECT 1 FROM growth.suppression_hashes h
               WHERE h.suppression_id = s.id
                 AND (h.key_version, h.identifier_hash) IN (${pairs.join(', ')}))`,
      params,
    );
    return rows.map((r) => ({ ...r, versions: r.versions ?? [] }));
  }
}
