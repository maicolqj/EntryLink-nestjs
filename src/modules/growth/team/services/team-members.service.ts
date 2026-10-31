import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GROWTH_ROLE_NAMES } from '../../shared/growth-access.catalog';
import { definedOnly, safeDiff } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthEntityType,
  GrowthTeamMemberStatus,
} from '../../shared/growth.enums';
import { IdentityDirectoryService } from '../../shared/identity-directory.service';
import { TeamMember } from '../entities/team-member.entity';
import {
  GrowthAddTeamMemberInput,
  GrowthTeamMemberFilterInput,
  GrowthUpdateTeamMemberInput,
} from '../dto/inputs/team-member.inputs';

const SAFE_FIELDS: (keyof TeamMember)[] = [
  'status',
  'territories',
  'maxActiveAssignments',
  'jobTitle',
];

@Injectable()
export class TeamMembersService {
  constructor(
    @InjectRepository(TeamMember)
    private readonly repo: Repository<TeamMember>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly identity: IdentityDirectoryService,
    private readonly activity: ActivityLogService,
  ) {}

  list(filter: GrowthTeamMemberFilterInput = {}): Promise<TeamMember[]> {
    return this.repo.find({
      where: filter.status ? { status: filter.status } : {},
      order: { displayName: 'ASC' },
      take: 100,
    });
  }

  /**
   * Solo entra al equipo un usuario de la plataforma con un rol de la suite
   * (o SUPER_ADMIN) y SIN vínculo con un conjunto: el equipo comercial no se
   * mezcla con la gente de las copropiedades.
   */
  async add(
    input: GrowthAddTeamMemberInput,
    actor: JwtAccessPayload,
  ): Promise<TeamMember> {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.identity.findActiveUser(input.userId, manager);
      if (!user) throw this.notFound('Usuario no encontrado');

      const hasSuiteRole = user.roles.some(
        (r) =>
          (GROWTH_ROLE_NAMES as string[]).includes(r) ||
          r === (ValidRoles.SUPER_ADMIN_ROL as string),
      );
      if (!hasSuiteRole || user.linkedToComplex) {
        throw new CustomError({
          message:
            'Solo se agregan usuarios con un rol comercial y sin vínculo con un conjunto',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GrowthErrorCode.GROWTH_TEAM_MEMBER_NOT_ELIGIBLE,
        });
      }

      const exists = await manager.findOne(TeamMember, {
        where: { userId: input.userId },
      });
      if (exists) {
        throw new CustomError({
          message: 'El usuario ya es integrante del equipo comercial',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_TEAM_MEMBER_EXISTS,
        });
      }

      const member = await manager.save(
        manager.create(TeamMember, {
          userId: input.userId,
          displayName: input.displayName.trim(),
          jobTitle: input.jobTitle?.trim() ?? null,
          territories: input.territories ?? [],
          maxActiveAssignments: input.maxActiveAssignments ?? null,
          status: GrowthTeamMemberStatus.ACTIVE,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.activity.record(manager, actor, {
        action: 'TEAM_MEMBER_ADDED',
        entityType: GrowthEntityType.TEAM_MEMBER,
        entityId: member.id,
        changes: { userId: member.userId, territories: member.territories },
      });
      return member;
    });
  }

  async update(
    id: string,
    input: GrowthUpdateTeamMemberInput,
    actor: JwtAccessPayload,
  ): Promise<TeamMember> {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(TeamMember, { where: { id } });
      if (!member) throw this.notFound('Integrante no encontrado');
      if (member.status === GrowthTeamMemberStatus.INACTIVE) {
        throw new CustomError({
          message: 'El integrante está inactivo',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_TEAM_MEMBER_INACTIVE,
        });
      }

      const before = { ...member };
      const patch: Partial<TeamMember> = {
        displayName: input.displayName?.trim(),
        jobTitle: input.jobTitle?.trim(),
        territories: input.territories,
        maxActiveAssignments: input.maxActiveAssignments,
      };
      Object.assign(member, definedOnly(patch));
      member.updatedByUserId = actor.sub;
      const saved = await manager.save(member);

      await this.activity.record(manager, actor, {
        action: 'TEAM_MEMBER_UPDATED',
        entityType: GrowthEntityType.TEAM_MEMBER,
        entityId: id,
        changes: safeDiff(before, patch, SAFE_FIELDS),
      });
      return saved;
    });
  }

  async deactivate(id: string, actor: JwtAccessPayload): Promise<TeamMember> {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(TeamMember, { where: { id } });
      if (!member) throw this.notFound('Integrante no encontrado');
      if (member.status === GrowthTeamMemberStatus.INACTIVE) return member;

      member.status = GrowthTeamMemberStatus.INACTIVE;
      member.leftAt = new Date();
      member.updatedByUserId = actor.sub;
      const saved = await manager.save(member);

      await this.activity.record(manager, actor, {
        action: 'TEAM_MEMBER_DEACTIVATED',
        entityType: GrowthEntityType.TEAM_MEMBER,
        entityId: id,
        changes: { status: { from: 'ACTIVE', to: 'INACTIVE' } },
      });
      return saved;
    });
  }

  private notFound(message: string) {
    return new CustomError({
      message,
      statusCode: HttpStatus.NOT_FOUND,
      errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
    });
  }
}
