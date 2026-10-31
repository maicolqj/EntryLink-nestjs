import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { addBusinessDays } from '../../shared/business-days.util';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthHashService } from '../../shared/growth-hash.service';
import {
  GrowthDataSubjectRequestStatus as Status,
  GrowthDataSubjectRequestType as RequestType,
  GrowthEntityType,
  GrowthSuppressionReason,
  GrowthSuppressionScope,
} from '../../shared/growth.enums';
import { DataSubjectRequest } from '../entities/data-subject-request.entity';
import {
  GrowthCloseDataSubjectRequestInput,
  GrowthCreateDataSubjectRequestInput,
  GrowthDataSubjectRequestFilterInput,
  GrowthExtendDataSubjectRequestInput,
} from '../dto/inputs/data-subject-request.inputs';
import { SuppressionsService } from './suppressions.service';

/**
 * Plazos de la Ley 1581 (arts. 14 y 15), pendientes de confirmación jurídica:
 * consulta 10 días hábiles + 5 de prórroga; reclamo 15 + 8.
 */
export const DSR_TERMS: Record<
  RequestType,
  { days: number; extension: number }
> = {
  [RequestType.ACCESS]: { days: 10, extension: 5 },
  [RequestType.RECTIFICATION]: { days: 15, extension: 8 },
  [RequestType.DELETION]: { days: 15, extension: 8 },
  [RequestType.REVOCATION]: { days: 15, extension: 8 },
  [RequestType.OBJECTION]: { days: 15, extension: 8 },
};

/**
 * Solicitudes que, resueltas, dejan al titular en la lista de exclusión. La
 * relación es en un solo sentido: agregan una exclusión, nunca la quitan.
 */
const ADDS_SUPPRESSION = new Set([
  RequestType.DELETION,
  RequestType.REVOCATION,
  RequestType.OBJECTION,
]);

const OPEN = [Status.RECEIVED, Status.IN_PROGRESS, Status.EXTENDED];

@Injectable()
export class DataSubjectRequestsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hashes: GrowthHashService,
    private readonly suppressions: SuppressionsService,
    private readonly activity: ActivityLogService,
  ) {}

  async create(
    input: GrowthCreateDataSubjectRequestInput,
    actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    const receivedAt = input.receivedAt ?? new Date();
    if (receivedAt.getTime() > Date.now() + 60_000) {
      throw this.invalid('La fecha de recepción no puede ser futura');
    }
    const subject = this.hashes.hashActive(
      input.identifierType,
      input.identifierValue,
    );

    return this.dataSource.transaction(async (manager) => {
      const request = await manager.save(
        manager.create(DataSubjectRequest, {
          requestType: input.requestType,
          channel: input.channel,
          subjectIdentifierType: input.identifierType,
          subjectKeyVersion: subject.keyVersion,
          subjectIdentifierHash: subject.hash,
          subjectContact: input.subjectContact?.trim() || null,
          receivedAt,
          dueAt: addBusinessDays(receivedAt, DSR_TERMS[input.requestType].days),
          status: Status.RECEIVED,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.activity.record(manager, actor, {
        action: 'PRIVACY_REQUEST_RECEIVED',
        entityType: GrowthEntityType.DATA_SUBJECT_REQUEST,
        entityId: request.id,
        changes: {
          requestType: request.requestType,
          channel: request.channel,
          dueAt: request.dueAt.toISOString(),
        },
      });
      return request;
    });
  }

  async start(
    id: string,
    actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    return this.transition(id, actor, [Status.RECEIVED], (request) => {
      request.status = Status.IN_PROGRESS;
      request.handledByUserId = actor.sub;
      return {
        action: 'PRIVACY_REQUEST_STARTED',
        changes: { status: Status.IN_PROGRESS },
      };
    });
  }

  async extend(
    id: string,
    input: GrowthExtendDataSubjectRequestInput,
    actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    return this.transition(
      id,
      actor,
      [Status.RECEIVED, Status.IN_PROGRESS],
      (request) => {
        request.status = Status.EXTENDED;
        request.extensionReason = input.reason.trim();
        request.extendedDueAt = addBusinessDays(
          request.dueAt,
          DSR_TERMS[request.requestType].extension,
        );
        request.handledByUserId = actor.sub;
        return {
          action: 'PRIVACY_REQUEST_EXTENDED',
          changes: {
            status: Status.EXTENDED,
            extendedDueAt: request.extendedDueAt.toISOString(),
          },
        };
      },
    );
  }

  /**
   * Cierra la solicitud. Al cerrar se borra el medio de respuesta del titular.
   * Si es RESOLVED y de tipo supresión/revocación/oposición, en la misma
   * transacción se agrega su exclusión (con el hash ya guardado).
   */
  async close(
    id: string,
    input: GrowthCloseDataSubjectRequestInput,
    actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    if (![Status.RESOLVED, Status.REJECTED].includes(input.outcome)) {
      throw this.invalid('El cierre debe ser RESOLVED o REJECTED');
    }
    return this.transition(id, actor, OPEN, async (request, manager) => {
      request.status = input.outcome;
      request.resolutionNotes = input.resolutionNotes.trim();
      request.resolvedAt = new Date();
      request.handledByUserId = actor.sub;
      request.subjectContact = null;
      request.contactRedactedAt = new Date();

      let suppressionId: string | null = null;
      if (
        input.outcome === Status.RESOLVED &&
        ADDS_SUPPRESSION.has(request.requestType)
      ) {
        const hash = {
          keyVersion: request.subjectKeyVersion,
          hash: request.subjectIdentifierHash,
        };
        const suppression = await this.suppressions.addHashed(manager, actor, {
          identifierType: request.subjectIdentifierType,
          candidates: [hash],
          writeHash: hash,
          scope: GrowthSuppressionScope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.SUBJECT_REQUEST,
          sourceRequestId: request.id,
        });
        suppressionId = suppression.id;
      }
      return {
        action:
          input.outcome === Status.RESOLVED
            ? 'PRIVACY_REQUEST_RESOLVED'
            : 'PRIVACY_REQUEST_REJECTED',
        changes: {
          status: input.outcome,
          suppressionId,
          contactRedacted: true,
        },
      };
    });
  }

  async list(
    filter: GrowthDataSubjectRequestFilterInput = {},
  ): Promise<DataSubjectRequest[]> {
    const qb = this.dataSource.manager
      .createQueryBuilder(DataSubjectRequest, 'r')
      .orderBy('r.dueAt', 'ASC')
      .take(100);
    if (filter.status)
      qb.andWhere('r.status = :status', { status: filter.status });
    if (filter.overdue) {
      qb.andWhere('r.status IN (:...open)', { open: OPEN }).andWhere(
        'COALESCE(r.extended_due_at, r.due_at) < now()',
      );
    }
    return qb.getMany();
  }

  private async transition(
    id: string,
    actor: JwtAccessPayload,
    from: Status[],
    apply: (
      request: DataSubjectRequest,
      manager: EntityManager,
    ) =>
      | { action: string; changes: Record<string, unknown> }
      | Promise<{ action: string; changes: Record<string, unknown> }>,
  ): Promise<DataSubjectRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(DataSubjectRequest, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) {
        throw new CustomError({
          message: 'Solicitud no encontrada',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
        });
      }
      if (!from.includes(request.status)) {
        throw new CustomError({
          message: `La solicitud está en estado ${request.status}`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
        });
      }
      const event = await apply(request, manager);
      request.updatedByUserId = actor.sub;
      const saved = await manager.save(request);
      await this.activity.record(manager, actor, {
        action: event.action,
        entityType: GrowthEntityType.DATA_SUBJECT_REQUEST,
        entityId: id,
        changes: event.changes,
      });
      return saved;
    });
  }

  private invalid(message: string) {
    return new CustomError({
      message,
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
    });
  }
}
