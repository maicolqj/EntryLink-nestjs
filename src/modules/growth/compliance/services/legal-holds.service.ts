import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityTarget, IsNull, ObjectLiteral } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import { GrowthDataSource } from '../../sources/entities/growth-data-source.entity';
import { TeamMember } from '../../team/entities/team-member.entity';
import {
  OrganizationChannel,
  PersonChannel,
} from '../../prospects/entities/channels.entity';
import {
  DuplicateCandidate,
  ScoringRule,
} from '../../prospects/entities/dedupe-scoring.entity';
import { Evidence } from '../../prospects/entities/evidence.entity';
import { GrowthSettings } from '../../prospects/entities/growth-settings.entity';
import { Organization } from '../../prospects/entities/organization.entity';
import { Person } from '../../prospects/entities/person.entity';
import { Property } from '../../prospects/entities/property.entity';
import { ProspectAssignment } from '../../prospects/entities/prospect-assignment.entity';
import {
  Employment,
  PropertyManagement,
} from '../../prospects/entities/relations.entity';
import { DataSubjectRequest } from '../entities/data-subject-request.entity';
import { LegalHold } from '../entities/legal-hold.entity';
import { Suppression } from '../entities/suppression.entity';
import {
  GrowthCreateLegalHoldInput,
  GrowthLegalHoldFilterInput,
  GrowthReleaseLegalHoldInput,
} from '../dto/inputs/legal-hold.inputs';

/**
 * La tabla es polimórfica (una retención cae sobre cualquier entidad de la
 * suite), así que la existencia de la entidad la valida este mapa. Una
 * entidad nueva de la suite debe agregarse aquí y al CHECK de la migración.
 */
const HOLDABLE: Record<GrowthEntityType, EntityTarget<ObjectLiteral>> = {
  [GrowthEntityType.TEAM_MEMBER]: TeamMember,
  [GrowthEntityType.DATA_SOURCE]: GrowthDataSource,
  [GrowthEntityType.SUPPRESSION]: Suppression,
  [GrowthEntityType.DATA_SUBJECT_REQUEST]: DataSubjectRequest,
  [GrowthEntityType.LEGAL_HOLD]: LegalHold,
  [GrowthEntityType.ORGANIZATION]: Organization,
  [GrowthEntityType.PERSON]: Person,
  [GrowthEntityType.PROPERTY]: Property,
  [GrowthEntityType.ORGANIZATION_CHANNEL]: OrganizationChannel,
  [GrowthEntityType.PERSON_CHANNEL]: PersonChannel,
  [GrowthEntityType.EMPLOYMENT]: Employment,
  [GrowthEntityType.PROPERTY_MANAGEMENT]: PropertyManagement,
  [GrowthEntityType.EVIDENCE]: Evidence,
  [GrowthEntityType.PROSPECT_ASSIGNMENT]: ProspectAssignment,
  [GrowthEntityType.SETTINGS]: GrowthSettings,
  [GrowthEntityType.DUPLICATE_CANDIDATE]: DuplicateCandidate,
  [GrowthEntityType.SCORING_RULE]: ScoringRule,
};

const MAX_YEARS = 10;

@Injectable()
export class LegalHoldsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
  ) {}

  list(filter: GrowthLegalHoldFilterInput = {}): Promise<LegalHold[]> {
    return this.dataSource.manager.find(LegalHold, {
      where: filter.activeOnly ? { releasedAt: IsNull() } : {},
      order: { holdUntil: 'ASC' },
      take: 100,
    });
  }

  async create(
    input: GrowthCreateLegalHoldInput,
    actor: JwtAccessPayload,
  ): Promise<LegalHold> {
    const until = new Date(`${input.holdUntil}T00:00:00Z`);
    const today = new Date();
    const max = new Date(today);
    max.setUTCFullYear(max.getUTCFullYear() + MAX_YEARS);
    if (Number.isNaN(until.getTime()) || until <= today || until > max) {
      throw this.invalid(
        `La fecha de retención debe ser posterior a hoy y de máximo ${MAX_YEARS} años`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const exists = await manager.exists(HOLDABLE[input.entityType], {
        where: { id: input.entityId },
      });
      if (!exists) throw this.invalid('La entidad a retener no existe');

      const hold = await manager.save(
        manager.create(LegalHold, {
          entityType: input.entityType,
          entityId: input.entityId,
          legalBasis: input.legalBasis.trim(),
          holdUntil: input.holdUntil,
          createdByUserId: actor.sub,
        }),
      );
      await this.activity.record(manager, actor, {
        action: 'LEGAL_HOLD_CREATED',
        entityType: GrowthEntityType.LEGAL_HOLD,
        entityId: hold.id,
        changes: {
          entityType: hold.entityType,
          entityId: hold.entityId,
          holdUntil: hold.holdUntil,
          legalBasis: hold.legalBasis,
        },
      });
      return hold;
    });
  }

  async release(
    id: string,
    input: GrowthReleaseLegalHoldInput,
    actor: JwtAccessPayload,
  ): Promise<LegalHold> {
    return this.dataSource.transaction(async (manager) => {
      const hold = await manager.findOne(LegalHold, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hold) {
        throw new CustomError({
          message: 'Retención no encontrada',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
        });
      }
      if (hold.releasedAt) throw this.invalid('La retención ya fue liberada');

      hold.releasedAt = new Date();
      hold.releasedByUserId = actor.sub;
      hold.releaseReason = input.reason.trim();
      const saved = await manager.save(hold);
      await this.activity.record(manager, actor, {
        action: 'LEGAL_HOLD_RELEASED',
        entityType: GrowthEntityType.LEGAL_HOLD,
        entityId: id,
        changes: { reason: hold.releaseReason },
      });
      return saved;
    });
  }

  private invalid(message: string) {
    return new CustomError({
      message,
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: GrowthErrorCode.GROWTH_LEGAL_HOLD_INVALID,
    });
  }
}
