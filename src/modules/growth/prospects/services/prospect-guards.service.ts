import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { actorHas } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthEntityType,
  GrowthSourceStatus,
} from '../../shared/growth.enums';
import { GrowthDataSource } from '../../sources/entities/growth-data-source.entity';
import { GrowthSettings } from '../entities/growth-settings.entity';
import { Organization } from '../entities/organization.entity';
import { Person } from '../entities/person.entity';
import { Property } from '../entities/property.entity';
import { GrowthProspectKind } from '../prospects.enums';
import { GrowthSourceReferenceInput } from '../dto/inputs/source-reference.input';

export const PROSPECT_TARGETS: Record<
  GrowthProspectKind,
  {
    entity: EntityTarget<ObjectLiteral>;
    table: string;
    entityType: GrowthEntityType;
    assignmentColumn: string;
  }
> = {
  [GrowthProspectKind.ORGANIZATION]: {
    entity: Organization,
    table: 'growth.organizations',
    entityType: GrowthEntityType.ORGANIZATION,
    assignmentColumn: 'organization_id',
  },
  [GrowthProspectKind.PERSON]: {
    entity: Person,
    table: 'growth.people',
    entityType: GrowthEntityType.PERSON,
    assignmentColumn: 'person_id',
  },
  [GrowthProspectKind.PROPERTY]: {
    entity: Property,
    table: 'growth.properties',
    entityType: GrowthEntityType.PROPERTY,
    assignmentColumn: 'property_id',
  },
};

/**
 * Reglas transversales de Prospect:
 *  - la fuente de un dato debe existir y estar ACTIVE;
 *  - visibilidad: sin VIEW_ALL_GROWTH_PROSPECTS solo se ve lo asignado a uno
 *    o lo que uno registró (lo invisible responde NOT_FOUND, sin revelar que
 *    existe);
 *  - separación de funciones: quien registró no valida, salvo la excepción
 *    configurable de SUPER_ADMIN, que queda en auditoría.
 */
@Injectable()
export class ProspectGuardsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
  ) {}

  async assertSourceUsable(
    manager: EntityManager,
    source: Pick<GrowthSourceReferenceInput, 'sourceId' | 'consultedAt'>,
  ): Promise<void> {
    const found = await manager.findOne(GrowthDataSource, {
      where: { id: source.sourceId },
    });
    if (!found || found.status !== GrowthSourceStatus.ACTIVE) {
      throw new CustomError({
        message:
          'La fuente no existe o no está activa (requiere revisión jurídica aprobada)',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_SOURCE_NOT_ACTIVE,
      });
    }
    if (source.consultedAt.getTime() > Date.now() + 60_000) {
      throw new CustomError({
        message: 'La fecha de consulta no puede ser futura',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
      });
    }
  }

  canSeeAll(actor: JwtAccessPayload): boolean {
    return actorHas(actor, ValidPermissions.VIEW_ALL_GROWTH_PROSPECTS);
  }

  /**
   * Condición SQL de visibilidad para listas. `alias` es el alias de la
   * entidad en el query builder.
   */
  scope(
    kind: GrowthProspectKind,
    alias: string,
    actor: JwtAccessPayload,
  ): { sql: string; params: Record<string, unknown> } | null {
    if (this.canSeeAll(actor)) return null;
    const column = PROSPECT_TARGETS[kind].assignmentColumn;
    return {
      sql: `(${alias}.created_by_user_id = :scopeUser OR EXISTS (
               SELECT 1 FROM growth.prospect_assignments pa
                 JOIN growth.team_members tm ON tm.id = pa.team_member_id
                WHERE pa.${column} = ${alias}.id AND pa.ended_at IS NULL
                  AND tm.user_id = :scopeUser))`,
      params: { scopeUser: actor.sub },
    };
  }

  async findVisible<T extends ObjectLiteral>(
    manager: EntityManager,
    kind: GrowthProspectKind,
    id: string,
    actor: JwtAccessPayload,
    lock = false,
  ): Promise<T> {
    const target = PROSPECT_TARGETS[kind];
    const qb = manager
      .createQueryBuilder(target.entity, 'e')
      .where('e.id = :id', { id });
    const scope = this.scope(kind, 'e', actor);
    if (scope) qb.andWhere(scope.sql, scope.params);
    if (lock) qb.setLock('pessimistic_write');
    const found = (await qb.getOne()) as T | null;
    if (!found) {
      throw new CustomError({
        message: 'Registro no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    return found;
  }

  /**
   * Separación de funciones. Si el actor registró lo que pretende validar o
   * verificar, solo pasa si es SUPER_ADMIN y la excepción está activa; en ese
   * caso queda un evento SELF_VALIDATION_EXCEPTION con usuario, registro y
   * operación.
   */
  async assertSegregation(
    manager: EntityManager,
    actor: JwtAccessPayload,
    ctx: {
      registeredByUserId: string;
      operation: string;
      entityType: GrowthEntityType;
      entityId: string;
    },
  ): Promise<void> {
    if (ctx.registeredByUserId !== actor.sub) return;

    const isSuperAdmin = !!actor.roles?.includes(ValidRoles.SUPER_ADMIN_ROL);
    const settings = await manager.findOne(GrowthSettings, {
      where: { id: 1 },
    });
    if (isSuperAdmin && settings?.allowSuperAdminSelfValidation) {
      await this.activity.record(manager, actor, {
        action: 'SELF_VALIDATION_EXCEPTION',
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        changes: { operation: ctx.operation, userId: actor.sub },
      });
      return;
    }
    throw new CustomError({
      message:
        'Quien registró el dato no puede validarlo (separación de funciones)',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: GrowthErrorCode.GROWTH_SELF_VALIDATION_FORBIDDEN,
    });
  }

  get manager(): EntityManager {
    return this.dataSource.manager;
  }
}
