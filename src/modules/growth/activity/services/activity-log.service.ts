import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { actorHas } from '../../shared/growth-actor';
import { GrowthEntityType } from '../../shared/growth.enums';
import { ActivityEvent } from '../entities/activity-event.entity';
import { GrowthActivityFilterInput } from '../dto/inputs/growth-activity-filter.input';
import { PaginatedGrowthActivityResponse } from '../dto/responses/paginated-growth-activity.response';

export interface GrowthActivityRecord {
  action: string;
  entityType: GrowthEntityType;
  entityId: string;
  /** Sin datos personales en claro: usar `safeDiff`. */
  changes?: Record<string, unknown> | null;
}

/**
 * Registro de actividad append-only. A propósito no hay métodos para editar
 * ni borrar (la spec lo verifica) y Postgres los rechaza con un trigger.
 *
 * `record` recibe el EntityManager de la transacción del cambio: si el cambio
 * se confirma, su registro también; si falla el registro, se revierte el
 * cambio. No hay escritura en la suite sin su evento.
 */
@Injectable()
export class ActivityLogService {
  constructor(
    @InjectRepository(ActivityEvent)
    private readonly repo: Repository<ActivityEvent>,
  ) {}

  async record(
    manager: EntityManager,
    actor: JwtAccessPayload,
    event: GrowthActivityRecord,
  ): Promise<void> {
    await manager.insert(ActivityEvent, {
      actorUserId: actor.entityType === 'user' ? actor.sub : null,
      actorRoles: actor.roles ?? [],
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      changes: event.changes ?? null,
    });
  }

  /** La actividad propia siempre; la de todos con VIEW_GROWTH_ACTIVITY. */
  async list(
    actor: JwtAccessPayload,
    filter: GrowthActivityFilterInput = {},
    pagination: PaginationInput = { page: 1, limit: 25 },
  ): Promise<PaginatedGrowthActivityResponse> {
    const qb = this.repo
      .createQueryBuilder('e')
      .orderBy('e.createdAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);

    if (!actorHas(actor, ValidPermissions.VIEW_GROWTH_ACTIVITY)) {
      qb.andWhere('e.actorUserId = :me', { me: actor.sub });
    } else if (filter.actorUserId) {
      qb.andWhere('e.actorUserId = :actor', { actor: filter.actorUserId });
    }
    if (filter.entityType) {
      qb.andWhere('e.entityType = :type', { type: filter.entityType });
    }
    if (filter.entityId) {
      qb.andWhere('e.entityId = :entityId', { entityId: filter.entityId });
    }

    const [items, totalItems] = await qb.getManyAndCount();
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
}
