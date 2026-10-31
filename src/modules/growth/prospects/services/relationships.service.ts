import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import { Person } from '../entities/person.entity';
import { Employment, PropertyManagement } from '../entities/relations.entity';
import {
  GrowthManagerType,
  GrowthProspectKind,
  GrowthRelationStatus,
  GrowthValidationStatus,
} from '../prospects.enums';
import {
  GrowthEndRelationInput,
  GrowthLinkEmploymentInput,
  GrowthSetPropertyManagerInput,
} from '../dto/inputs/relations.inputs';
import { EvidencesService } from './evidences.service';
import { invalid } from './organizations.service';
import { ProspectGuardsService } from './prospect-guards.service';

/**
 * Relaciones con historial:
 *  - persona ↔ empresa (una persona puede pasar por varias empresas y volver);
 *  - copropiedad ↔ quien la administra (una sola vigente: registrar una nueva
 *    CURRENT cierra la anterior en la misma transacción).
 * Nada se borra: se cierra con fecha de fin.
 */
@Injectable()
export class RelationshipsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly evidences: EvidencesService,
    private readonly activity: ActivityLogService,
  ) {}

  async linkEmployment(
    input: GrowthLinkEmploymentInput,
    actor: JwtAccessPayload,
  ): Promise<Employment> {
    return this.dataSource.transaction(async (manager) => {
      await this.guards.findVisible(
        manager,
        GrowthProspectKind.PERSON,
        input.personId,
        actor,
      );
      await this.guards.findVisible(
        manager,
        GrowthProspectKind.ORGANIZATION,
        input.organizationId,
        actor,
      );
      await this.guards.assertSourceUsable(manager, input.source);
      const employment = await manager.save(
        manager.create(Employment, {
          personId: input.personId,
          organizationId: input.organizationId,
          roleTitle: input.roleTitle?.trim() ?? null,
          startedOn: input.startedOn ?? null,
          status: input.status,
          sourceId: input.source.sourceId,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: GrowthEntityType.EMPLOYMENT, entityId: employment.id },
        {
          organizationId: input.organizationId,
          roleTitle: input.roleTitle,
          startedOn: input.startedOn,
        },
        input.source,
      );
      await this.activity.record(manager, actor, {
        action: 'EMPLOYMENT_LINKED',
        entityType: GrowthEntityType.EMPLOYMENT,
        entityId: employment.id,
        changes: {
          personId: input.personId,
          organizationId: input.organizationId,
          status: input.status,
        },
      });
      return employment;
    });
  }

  async endEmployment(
    id: string,
    input: GrowthEndRelationInput,
    actor: JwtAccessPayload,
  ): Promise<Employment> {
    return this.dataSource.transaction(async (manager) => {
      const employment = await this.findOrFail(manager, Employment, id);
      await this.guards.findVisible(
        manager,
        GrowthProspectKind.PERSON,
        employment.personId,
        actor,
      );
      assertEnd(employment, input.endedOn);
      employment.endedOn = input.endedOn;
      employment.status = GrowthRelationStatus.PAST;
      employment.updatedByUserId = actor.sub;
      const saved = await manager.save(employment);
      await this.activity.record(manager, actor, {
        action: 'EMPLOYMENT_ENDED',
        entityType: GrowthEntityType.EMPLOYMENT,
        entityId: id,
        changes: { endedOn: input.endedOn },
      });
      return saved;
    });
  }

  async setPropertyManager(
    input: GrowthSetPropertyManagerInput,
    actor: JwtAccessPayload,
  ): Promise<PropertyManagement> {
    return this.dataSource.transaction(async (manager) => {
      await this.guards.findVisible(
        manager,
        GrowthProspectKind.PROPERTY,
        input.propertyId,
        actor,
        true,
      );
      await this.guards.assertSourceUsable(manager, input.source);
      await this.assertManagerCoherent(manager, input, actor);

      // Una sola administración vigente: la anterior se cierra hoy.
      let closedId: string | null = null;
      if (input.status === GrowthRelationStatus.CURRENT) {
        const current = await manager.findOne(PropertyManagement, {
          where: {
            propertyId: input.propertyId,
            status: GrowthRelationStatus.CURRENT,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (current) {
          current.status = GrowthRelationStatus.PAST;
          current.endedOn = input.startedOn ?? today();
          if (current.startedOn && current.endedOn < current.startedOn) {
            current.endedOn = current.startedOn;
          }
          current.updatedByUserId = actor.sub;
          await manager.save(current);
          closedId = current.id;
        }
      }

      const management = await manager.save(
        manager.create(PropertyManagement, {
          propertyId: input.propertyId,
          managerType: input.managerType,
          organizationId: input.organizationId ?? null,
          personId: input.personId ?? null,
          responsiblePersonId: input.responsiblePersonId ?? null,
          startedOn: input.startedOn ?? null,
          status: input.status,
          sourceId: input.source.sourceId,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.evidences.recordFields(
        manager,
        actor,
        {
          entityType: GrowthEntityType.PROPERTY_MANAGEMENT,
          entityId: management.id,
        },
        {
          managerType: input.managerType,
          organizationId: input.organizationId,
          personId: input.personId,
          responsiblePersonId: input.responsiblePersonId,
          startedOn: input.startedOn,
        },
        input.source,
      );
      await this.activity.record(manager, actor, {
        action: 'PROPERTY_MANAGER_SET',
        entityType: GrowthEntityType.PROPERTY_MANAGEMENT,
        entityId: management.id,
        changes: {
          propertyId: input.propertyId,
          managerType: input.managerType,
          organizationId: input.organizationId ?? null,
          personId: input.personId ?? null,
          status: input.status,
          closedPrevious: closedId,
        },
      });
      return management;
    });
  }

  async endPropertyManagement(
    id: string,
    input: GrowthEndRelationInput,
    actor: JwtAccessPayload,
  ): Promise<PropertyManagement> {
    return this.dataSource.transaction(async (manager) => {
      const management = await this.findOrFail(manager, PropertyManagement, id);
      await this.guards.findVisible(
        manager,
        GrowthProspectKind.PROPERTY,
        management.propertyId,
        actor,
      );
      assertEnd(management, input.endedOn);
      management.endedOn = input.endedOn;
      management.status = GrowthRelationStatus.PAST;
      management.updatedByUserId = actor.sub;
      const saved = await manager.save(management);
      await this.activity.record(manager, actor, {
        action: 'PROPERTY_MANAGEMENT_ENDED',
        entityType: GrowthEntityType.PROPERTY_MANAGEMENT,
        entityId: id,
        changes: { endedOn: input.endedOn },
      });
      return saved;
    });
  }

  employmentsOfPerson(personId: string): Promise<Employment[]> {
    return this.dataSource.manager.find(Employment, {
      where: { personId },
      order: { createdAt: 'DESC' },
    });
  }

  employmentsOfOrganization(organizationId: string): Promise<Employment[]> {
    return this.dataSource.manager.find(Employment, {
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  managementsOfProperty(propertyId: string): Promise<PropertyManagement[]> {
    return this.dataSource.manager.find(PropertyManagement, {
      where: { propertyId },
      order: { createdAt: 'DESC' },
    });
  }

  managementsByOrganization(
    organizationId: string,
  ): Promise<PropertyManagement[]> {
    return this.dataSource.manager.find(PropertyManagement, {
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  managementsByPerson(personId: string): Promise<PropertyManagement[]> {
    return this.dataSource.manager.find(PropertyManagement, {
      where: { personId },
      order: { createdAt: 'DESC' },
    });
  }

  private async assertManagerCoherent(
    manager: EntityManager,
    input: GrowthSetPropertyManagerInput,
    actor: JwtAccessPayload,
  ): Promise<void> {
    const t = input.managerType;
    if (t === GrowthManagerType.ORGANIZATION) {
      if (!input.organizationId || input.personId) {
        throw invalid(
          'Una administración por empresa exige organizationId y no personId',
        );
      }
      await this.guards.findVisible(
        manager,
        GrowthProspectKind.ORGANIZATION,
        input.organizationId,
        actor,
      );
    } else if (t === GrowthManagerType.PERSON) {
      if (
        !input.personId ||
        input.organizationId ||
        input.responsiblePersonId
      ) {
        throw invalid(
          'Una administración por persona exige personId, sin empresa ni responsable',
        );
      }
      await this.guards.findVisible(
        manager,
        GrowthProspectKind.PERSON,
        input.personId,
        actor,
      );
    } else if (input.organizationId || input.personId) {
      throw invalid(
        'Una copropiedad autogestionada no lleva empresa ni persona',
      );
    }

    // El responsable designado solo se registra si está validado.
    if (input.responsiblePersonId) {
      const responsible = await this.guards.findVisible<Person>(
        manager,
        GrowthProspectKind.PERSON,
        input.responsiblePersonId,
        actor,
      );
      if (responsible.validationStatus !== GrowthValidationStatus.VALIDATED) {
        throw new CustomError({
          message: 'El administrador responsable debe estar validado',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GrowthErrorCode.GROWTH_VALIDATION_INCOMPLETE,
        });
      }
    }
  }

  private async findOrFail<T extends Employment | PropertyManagement>(
    manager: EntityManager,
    entity: new () => T,
    id: string,
  ): Promise<T> {
    const row = await manager.findOne(entity, {
      where: { id } as never,
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) {
      throw new CustomError({
        message: 'Relación no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    return row;
  }
}

function assertEnd(
  relation: { status: GrowthRelationStatus; startedOn?: string | null },
  endedOn: string,
): void {
  if (relation.status === GrowthRelationStatus.PAST) {
    throw new CustomError({
      message: 'La relación ya terminó',
      statusCode: HttpStatus.CONFLICT,
      errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
    });
  }
  if (relation.startedOn && endedOn < relation.startedOn) {
    throw invalid('La fecha de fin no puede ser anterior a la de inicio');
  }
}

function today(): string {
  return new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
}
