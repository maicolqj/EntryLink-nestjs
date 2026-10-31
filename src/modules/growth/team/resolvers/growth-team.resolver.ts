import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { TeamMember } from '../entities/team-member.entity';
import {
  GrowthAddTeamMemberInput,
  GrowthTeamMemberFilterInput,
  GrowthUpdateTeamMemberInput,
} from '../dto/inputs/team-member.inputs';
import { TeamMembersService } from '../services/team-members.service';

@Resolver(() => TeamMember)
export class GrowthTeamResolver {
  constructor(private readonly team: TeamMembersService) {}

  @Auth({ permissions: [ValidPermissions.VIEW_GROWTH_TEAM] })
  @Query(() => [TeamMember], { name: 'growthTeamMembers' })
  growthTeamMembers(
    @Args('filter', { nullable: true }) filter?: GrowthTeamMemberFilterInput,
  ): Promise<TeamMember[]> {
    return this.team.list(filter ?? {});
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_TEAM] })
  @Mutation(() => TeamMember, { name: 'growthAddTeamMember' })
  growthAddTeamMember(
    @Args('input') input: GrowthAddTeamMemberInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<TeamMember> {
    return this.team.add(input, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_TEAM] })
  @Mutation(() => TeamMember, { name: 'growthUpdateTeamMember' })
  growthUpdateTeamMember(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthUpdateTeamMemberInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<TeamMember> {
    return this.team.update(id, input, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_TEAM] })
  @Mutation(() => TeamMember, {
    name: 'growthDeactivateTeamMember',
    description:
      'Desactiva al integrante. No se borra: su historial se conserva.',
  })
  growthDeactivateTeamMember(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<TeamMember> {
    return this.team.deactivate(id, actor);
  }
}
