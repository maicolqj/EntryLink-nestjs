import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { RolesService } from './roles.service';
import { Role } from './entities/role.entity';
import { AssignChildrenResponse, ChangeParentResponse, MoveSubtreeResponse, PaginatedRolesResponse, RemoveRoleResponse, RestoreRoleResponse, RoleHierarchyResponse, SimpleRoleResponse, RoleDetailResponse } from './dto/responses';
import { CreateRoleInput } from './dto/inputs/create-role.input';
import { SearchRolesInput } from './dto/inputs/search-roles.input';
import { UpdateRoleInput } from './dto/inputs/update-role.input';
import { AssignedUserRolResponse } from './dto/responses/assigned-role-user.response';
import { ValidRoles } from './enums/valid-roles';
import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';


@Resolver(() => Role)
export class RolesResolver {
  constructor(private readonly rolesService: RolesService) { }

  @Mutation(() => SimpleRoleResponse, { name: 'createRole' })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  createRole(@Args('input') createRoleInput: CreateRoleInput) {
    return this.rolesService.create(createRoleInput);
  }


  @Query(() => PaginatedRolesResponse, { name: 'roles' })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  findAll(
    @Args('input') input: SearchRolesInput): Promise<PaginatedRolesResponse> {
    return this.rolesService.findAll(input);
  }


  @Query(() => Role, { name: 'role' })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  findOne(@Args('term', { type: () => String }) term: string) {
    return this.rolesService.findOne(term);
  }

  @Query(() => RoleDetailResponse, {
    name: 'roleDetail',
    description: 'Obtiene la información completa de un rol con sus permisos agrupados por categoría',
  })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  findRoleDetail(
    @Args('id', { type: () => String, description: 'UUID del rol' }) id: string,
  ): Promise<RoleDetailResponse> {
    return this.rolesService.findRoleDetail(id);
  }

  @Mutation(() => Role)
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  updateRole(
    @Args('id', { type: () => String }) id: string,
    @Args('input') updateRoleInput: UpdateRoleInput) {
    return this.rolesService.update(id, updateRoleInput);
  }

  @Mutation(() => ChangeParentResponse)
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async changeRoleParent(
    @Args('roleId') roleId: string,
    @Args('newParentId', { nullable: true }) newParentId: string | null,
  ): Promise<ChangeParentResponse> {
    return this.rolesService.changeRoleParent(roleId, newParentId);
  }

  @Mutation(() => MoveSubtreeResponse)
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async moveRoleSubtree(
    @Args('roleId') roleId: string,
    @Args('newParentId', { nullable: true }) newParentId: string | null,
  ): Promise<MoveSubtreeResponse> {
    return this.rolesService.moveRoleSubtree(roleId, newParentId);
  }

  @Mutation(() => AssignChildrenResponse)
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async assignMultipleChildren(
    @Args('parentId') parentId: string,
    @Args('childrenIds', { type: () => [String] }) childrenIds: string[],
  ): Promise<AssignChildrenResponse> {
    return this.rolesService.assignMultipleChildren(parentId, childrenIds);
  }

  @Query(() => RoleHierarchyResponse)
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async getRoleHierarchy(
    @Args('roleId') roleId: string,
  ): Promise<RoleHierarchyResponse> {
    return this.rolesService.getRoleHierarchy(roleId);
  }

  @Mutation(() => RemoveRoleResponse, {
    name: 'removeRole',
    description: 'Soft delete a role by setting status to false'
  })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async removePermission(
    @Args('id', { type: () => String }) id: string,
  ): Promise<RemoveRoleResponse> {
    return await this.rolesService.remove(id);
  }

  @Mutation(() => RestoreRoleResponse, {
    name: 'restoreRole',
    description: 'Restore a soft deleted role by setting status to true'
  })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async restorePermission(
    @Args('id', { type: () => String }) id: string,
  ): Promise<RestoreRoleResponse> {
    return await this.rolesService.restore(id);
  }

  @Mutation(() => AssignedUserRolResponse, {
    description: 'Asigna un rol a un usuario'
  })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async assignRoleToUser(
    @CurrentUser() user: User,
    @Args('userId') userId: string,
    @Args('roleName') roleName: ValidRoles,
  ): Promise<AssignedUserRolResponse> {
    return await this.rolesService.assignRoleToUser(user.id, userId, roleName);
  }

  @Mutation(() => AssignedUserRolResponse, {
    description: 'Asigna un rol a un usuario'
  })
  @Auth({ permissions: [ValidRoles.SUPER_ADMIN_ROL] })
  async userHasRole(
    @CurrentUser() user: User,
    @Args('userId') userId: string,
    @Args('roleName') roleName: ValidRoles,
  ): Promise<AssignedUserRolResponse> {
    return this.rolesService.assignRoleToUser(user.id, userId, roleName);
  }
}
  