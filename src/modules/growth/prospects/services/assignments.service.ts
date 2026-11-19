import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthTeamMemberStatus } from '../../shared/growth.enums';
import { TeamMember } from '../../team/entities/team-member.entity';
import { ProspectAssignment } from '../entities/prospect-assignment.entity';
import { GrowthProspectKind } from '../prospects.enums';
import {
  GrowthAssignProspectInput,
  GrowthProspectRefInput,
} from '../dto/inputs/relations.inputs';
import {
  PROSPECT_TARGETS,
  ProspectGuardsService,
} from './prospect-guards.service';

const COLUMN: Record<GrowthProspectKind, keyof ProspectAssignment> = {
  [GrowthProspectKind.ORGANIZATION]: 'organizationId',
  [GrowthProspectKind.PERSON]: 'personId',
  [GrowthProspectKind.PROPERTY]: 'propertyId',
};

/**
 * Responsable de cada prospecto, con historial completo: reasignar cierra la
 * asignación vigente y abre otra en la misma transacción (la base permite
 * una sola vigente por prospecto).
 */
@Injectable()
export class AssignmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly activity: ActivityLogService,
  ) {}

  async assign(
    input: GrowthAssignProspectInput,
    actor: JwtAccessPayload,
  ): Promise<ProspectAssignment> {
    return this.dataSource.transaction(async (manager) => {
      const { kind, id } = input.prospect;
      await this.guards.findVisible(manager, kind, id, actor, true);
      const member = await manager.findOne(TeamMember, {
        where: { id: input.teamMemberId },
      });
      if (!member || member.status !== GrowthTeamMemberStatus.ACTIVE) {
        throw new CustomError({
          message: 'El responsable no es un integrante activo del equipo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GrowthErrorCode.GROWTH_TEAM_MEMBER_INACTIVE,
        });
      }
      const current = await this.current(manager, kind, id);
      if (current?.teamMemberId === member.id) return current;
      if (current) await this.close(manager, current, actor);

      if (member.maxActiveAssignments) {
        const active = await manager.count(ProspectAssignment, {
          where: { teamMemberId: member.id, endedAt: IsNull() },
        });
        if (active >= member.maxActiveAssignments) {
          throw new CustomError({
            message:
              'El responsable alcanzó su capacidad máxima de asignaciones',
            statusCode: HttpStatus.CONFLICT,
            errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
          });
        }
      }

      const assignment = await manager.save(
        manager.create(ProspectAssignment, {
          [COLUMN[kind]]: id,
          teamMemberId: member.id,
          assignedByUserId: actor.sub,
          reason: input.reason?.trim() ?? null,
        }),
      );
      await this.activity.record(manager, actor, {
        action: current ? 'PROSPECT_REASSIGNED' : 'PROSPECT_ASSIGNED',
        entityType: PROSPECT_TARGETS[kind].entityType,
        entityId: id,
        changes: {
          teamMemberId: { from: current?.teamMemberId ?? null, to: member.id },
          assignmentId: assignment.id,
        },
      });
      return assignment;
    });
  }

  async unassign(
    ref: GrowthProspectRefInput,
    actor: JwtAccessPayload,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      await this.guards.findVisible(manager, ref.kind, ref.id, actor, true);
      const current = await this.current(manager, ref.kind, ref.id);
      if (!current) return false;
      await this.close(manager, current, actor);
      await this.activity.record(manager, actor, {
        action: 'PROSPECT_UNASSIGNED',
        entityType: PROSPECT_TARGETS[ref.kind].entityType,
        entityId: ref.id,
        changes: { teamMemberId: { from: current.teamMemberId, to: null } },
      });
      return true;
    });
  }

  async history(
    ref: GrowthProspectRefInput,
    actor: JwtAccessPayload,
  ): Promise<ProspectAssignment[]> {
    await this.guards.findVisible(
      this.dataSource.manager,
      ref.kind,
      ref.id,
      actor,
    );
    return this.dataSource.manager.find(ProspectAssignment, {
      where: { [COLUMN[ref.kind]]: ref.id },
      order: { startedAt: 'DESC' },
    });
  }

  currentFor(
    kind: GrowthProspectKind,
    id: string,
  ): Promise<ProspectAssignment | null> {
    return this.current(this.dataSource.manager, kind, id);
  }

  private current(
    manager: EntityManager,
    kind: GrowthProspectKind,
    id: string,
  ): Promise<ProspectAssignment | null> {
    return manager.findOne(ProspectAssignment, {
      where: { [COLUMN[kind]]: id, endedAt: IsNull() },
    });
  }

  private async close(
    manager: EntityManager,
    assignment: ProspectAssignment,
    actor: JwtAccessPayload,
  ): Promise<void> {
    assignment.endedAt = new Date();
    assignment.endedByUserId = actor.sub;
    await manager.save(assignment);
  }
}
