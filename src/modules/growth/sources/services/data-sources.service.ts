import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { definedOnly, safeDiff } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthEntityType,
  GrowthLegalReviewStatus,
  GrowthSourceKind,
  GrowthSourceStatus,
} from '../../shared/growth.enums';
import { GrowthDataSource } from '../entities/growth-data-source.entity';
import {
  GrowthApproveSourceCostInput,
  GrowthCreateDataSourceInput,
  GrowthReviewSourceLegalInput,
  GrowthSetSourceStatusInput,
  GrowthUpdateDataSourceInput,
} from '../dto/inputs/data-source.inputs';

// Las fuentes no tienen datos personales: todos sus campos se pueden auditar.
const SAFE_FIELDS: (keyof GrowthDataSource)[] = [
  'name',
  'kind',
  'baseUrl',
  'termsSummary',
  'processingPurpose',
  'allowsAutomation',
  'status',
  'legalReviewStatus',
  'monthlyBudgetCop',
  'monthlyRequestCap',
];

/** Cambiar cualquiera de estos campos obliga a revisar la fuente otra vez. */
const DEFINING_FIELDS: (keyof GrowthUpdateDataSourceInput)[] = [
  'kind',
  'baseUrl',
  'termsSummary',
  'processingPurpose',
  'allowsAutomation',
];

@Injectable()
export class DataSourcesService {
  constructor(
    @InjectRepository(GrowthDataSource)
    private readonly repo: Repository<GrowthDataSource>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
  ) {}

  list(): Promise<GrowthDataSource[]> {
    return this.repo.find({ order: { name: 'ASC' }, take: 100 });
  }

  async create(
    input: GrowthCreateDataSourceInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.dataSource.transaction(async (manager) => {
      const taken = await manager.findOne(GrowthDataSource, {
        where: { code: input.code },
        withDeleted: true,
      });
      if (taken) {
        throw new CustomError({
          message: `Ya existe una fuente con el código ${input.code}`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_SOURCE_CODE_TAKEN,
        });
      }
      const source = await manager.save(
        manager.create(GrowthDataSource, {
          ...input,
          requiresCostApproval: input.kind === GrowthSourceKind.PAID_API,
          status: GrowthSourceStatus.PENDING_APPROVAL,
          legalReviewStatus: GrowthLegalReviewStatus.PENDING,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.activity.record(manager, actor, {
        action: 'SOURCE_CREATED',
        entityType: GrowthEntityType.DATA_SOURCE,
        entityId: source.id,
        changes: { code: source.code, kind: source.kind },
      });
      return source;
    });
  }

  async update(
    id: string,
    input: GrowthUpdateDataSourceInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.dataSource.transaction(async (manager) => {
      const source = await this.findOrFail(manager, id);
      const before = { ...source };

      Object.assign(source, definedOnly(input));

      const redefined = DEFINING_FIELDS.some(
        (f) =>
          input[f] !== undefined &&
          JSON.stringify(input[f]) !== JSON.stringify(before[f]),
      );
      if (redefined) this.resetApprovals(source);
      source.requiresCostApproval =
        source.kind === GrowthSourceKind.PAID_API ||
        (source.requiresCostApproval && !redefined);
      source.updatedByUserId = actor.sub;
      const saved = await manager.save(source);

      await this.activity.record(manager, actor, {
        action: redefined ? 'SOURCE_REDEFINED' : 'SOURCE_UPDATED',
        entityType: GrowthEntityType.DATA_SOURCE,
        entityId: id,
        changes: safeDiff(before, saved, SAFE_FIELDS),
      });
      return saved;
    });
  }

  async reviewLegal(
    id: string,
    input: GrowthReviewSourceLegalInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.dataSource.transaction(async (manager) => {
      const source = await this.findOrFail(manager, id);
      const before = { ...source };
      source.legalReviewStatus = input.decision;
      source.legalReviewReference = input.reference.trim();
      source.legalReviewedByUserId = actor.sub;
      source.legalReviewedAt = new Date();
      if (input.decision === GrowthLegalReviewStatus.REJECTED) {
        source.status = GrowthSourceStatus.DISABLED;
      }
      source.updatedByUserId = actor.sub;
      const saved = await manager.save(source);

      await this.activity.record(manager, actor, {
        action: 'SOURCE_LEGAL_REVIEWED',
        entityType: GrowthEntityType.DATA_SOURCE,
        entityId: id,
        changes: {
          ...safeDiff(before, saved, SAFE_FIELDS),
          reference: input.reference.trim(),
        },
      });
      return saved;
    });
  }

  /** Aprueba costo, presupuesto y tope de una fuente de pago. Nunca activa la fuente. */
  async approveCost(
    id: string,
    input: GrowthApproveSourceCostInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.dataSource.transaction(async (manager) => {
      const source = await this.findOrFail(manager, id);
      if (!source.requiresCostApproval) {
        throw new CustomError({
          message: 'Esta fuente no requiere aprobación de costo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
        });
      }
      const before = { ...source };
      source.monthlyBudgetCop = input.monthlyBudgetCop;
      source.monthlyRequestCap = input.monthlyRequestCap;
      source.costEstimateNotes = input.costEstimateNotes.trim();
      source.costApprovedByUserId = actor.sub;
      source.costApprovedAt = new Date();
      source.updatedByUserId = actor.sub;
      const saved = await manager.save(source);

      await this.activity.record(manager, actor, {
        action: 'SOURCE_COST_APPROVED',
        entityType: GrowthEntityType.DATA_SOURCE,
        entityId: id,
        changes: safeDiff(before, saved, SAFE_FIELDS),
      });
      return saved;
    });
  }

  async setStatus(
    id: string,
    input: GrowthSetSourceStatusInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.dataSource.transaction(async (manager) => {
      const source = await this.findOrFail(manager, id);
      if (input.status === GrowthSourceStatus.ACTIVE) {
        const missing: string[] = [];
        if (source.legalReviewStatus !== GrowthLegalReviewStatus.APPROVED) {
          missing.push('revisión jurídica aprobada');
        }
        if (
          source.requiresCostApproval &&
          (!source.costApprovedAt ||
            source.monthlyBudgetCop == null ||
            !source.monthlyRequestCap)
        ) {
          missing.push('aprobación de costo con presupuesto y tope');
        }
        if (missing.length) {
          throw new CustomError({
            message: `La fuente no se puede activar: falta ${missing.join(' y ')}`,
            statusCode: HttpStatus.CONFLICT,
            errorCode: GrowthErrorCode.GROWTH_SOURCE_NOT_ACTIVATABLE,
          });
        }
      }
      const before = { ...source };
      source.status = input.status;
      source.updatedByUserId = actor.sub;
      const saved = await manager.save(source);

      await this.activity.record(manager, actor, {
        action: 'SOURCE_STATUS_CHANGED',
        entityType: GrowthEntityType.DATA_SOURCE,
        entityId: id,
        changes: safeDiff(before, saved, SAFE_FIELDS),
      });
      return saved;
    });
  }

  private resetApprovals(source: GrowthDataSource): void {
    source.legalReviewStatus = GrowthLegalReviewStatus.PENDING;
    source.legalReviewReference = null;
    source.legalReviewedByUserId = null;
    source.legalReviewedAt = null;
    source.costApprovedAt = null;
    source.costApprovedByUserId = null;
    if (source.status === GrowthSourceStatus.ACTIVE) {
      source.status = GrowthSourceStatus.PENDING_APPROVAL;
    }
  }

  private async findOrFail(
    manager: EntityManager,
    id: string,
  ): Promise<GrowthDataSource> {
    const source = await manager.findOne(GrowthDataSource, { where: { id } });
    if (!source) {
      throw new CustomError({
        message: 'Fuente no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    return source;
  }
}
