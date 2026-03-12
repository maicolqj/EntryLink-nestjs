import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { PermissionsService } from './services/permissions.service';
import { Permission } from './entities/permission.entity';
import { CreatePermissionInput } from './dto/inputs/create-permission.input';
import { UpdatePermissionInput } from './dto/inputs/update-permission.input';
import { CreatePermissionResponse } from './dto/responses/create-permission-response';
import { PermissionDependencyService } from './services/permission-dependecy.service';
import { ValidRoles } from '../roles/enums/valid-roles';
import { Auth } from '../shared/decorators/auth.decorator';
import { PaginatedPermissionsResponse } from './dto/responses/paginate-permissions.response';
import { SearchPermissionsInput } from './dto/inputs/search-permission.input';
import { UpdatePermissionResponse } from './dto/responses/updated-permission-response';
import { RemovePermissionResponse } from './dto/responses/remove-permission.response';
import { RestorePermissionResponse } from './dto/responses/restore-permission.response';

@Resolver(() => Permission)
export class PermissionsResolver {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly dependencyService: PermissionDependencyService
  ) { }

  @Mutation(() => CreatePermissionResponse)
  // @Auth({roles: [ValidRoles.SUPER_ADMIN_ROL]})
  async createPermission(
    @Args('input') input: CreatePermissionInput): Promise<CreatePermissionResponse> {
    console.log(`CREATING PERMISSION ${JSON.stringify(input)}`);
    if (input.dependsOn && input.dependsOn.length > 0) {
      const permission = await this.permissionsService.create({
        ...input,
        dependsOn: undefined,
      });

      return this.dependencyService.updatePermissionDependencies(
        permission.id,
        input.dependsOn.map(dep => dep.id)

      );
    }
    return this.permissionsService.create(input);
  }

 @Query(() => PaginatedPermissionsResponse, { name: 'permissions' })
  // @Auth({permissions: [ValidRoles.SUPER_ADMIN_ROL]})
  findAll(
    @Args('input') input: SearchPermissionsInput): Promise<PaginatedPermissionsResponse> {
    return this.permissionsService.findAll(input);
  }


@Query(() => Permission, { name: 'permission' })
  // @Auth({permissions: [ValidRoles.SUPER_ADMIN_ROL]})
  findOne(@Args('id', { type: () => String }) id: string) {
    return this.permissionsService.findOne(id);
  }

 @Mutation(() => UpdatePermissionResponse, {
    name: 'updatePermission',
    description: 'Update an existing permission'
  })
  @Auth({permissions: [ValidRoles.SUPER_ADMIN_ROL]})
  async updatePermission(
    @Args('id', { type: () => String }) id: string,
    @Args('updatePermissionInput') updatePermissionInput: UpdatePermissionInput,
  ): Promise<UpdatePermissionResponse> {
    return await this.permissionsService.update(id, updatePermissionInput);
  }

  @Mutation(() => RemovePermissionResponse, {
    name: 'removePermission',
    description: 'Soft delete a permission by setting status to false'
  })
  @Auth({permissions: [ValidRoles.SUPER_ADMIN_ROL]})
  async removePermission(
    @Args('id', { type: () => String }) id: string,
  ): Promise<RemovePermissionResponse> {
    return await this.permissionsService.remove(id);
  }

  @Mutation(() => RestorePermissionResponse, {
    name: 'restorePermission',
    description: 'Restore a soft deleted permission by setting status to true'
  })
  @Auth({permissions: [ValidRoles.SUPER_ADMIN_ROL]})
  async restorePermission(
    @Args('id', { type: () => String }) id: string,
  ): Promise<RestorePermissionResponse> {
    return await this.permissionsService.restore(id);
  }
}
