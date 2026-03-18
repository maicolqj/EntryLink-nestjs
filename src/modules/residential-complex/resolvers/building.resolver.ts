import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Building }                   from '../entities/building.entity';
import { BuildingService }            from '../services/building.service';
import { CreateBuildingInput }        from '../dto/inputs/create-building.input';
import { UpdateBuildingInput }        from '../dto/inputs/update-building.input';
import { PaginatedBuildingsResponse } from '../dto/responses/paginated-buildings.response';
import { PaginationInput }            from '../../shared/dto/inputs/pagination.input';
import { Auth }                       from '../../shared/decorators/auth.decorator';
import { CurrentUser }                from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload }           from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }                 from '../../roles/enums/valid-roles';
import { ValidPermissions }           from '../../permissions/enums/valid-permissions';

@Resolver(() => Building)
export class BuildingResolver {

  constructor(private readonly buildingService: BuildingService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  @Mutation(() => Building, { name: 'createBuilding' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL] })
  create(
    @Args('input') input: CreateBuildingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Building> {
    return this.buildingService.create({ ...input, complexId: currentUser.complexId }, currentUser);
  }

  @Mutation(() => Building, { name: 'updateBuilding' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL], permissions: [ValidPermissions.EDIT_RESIDENCE] })
  update(
    @Args('input') input: UpdateBuildingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Building> {
    return this.buildingService.update(input, currentUser);
  }

  @Mutation(() => Building, { name: 'toggleBuildingStatus' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL], permissions: [ValidPermissions.TOGGLE_RESIDENCE_STATUS] })
  toggleStatus(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Building> {
    return this.buildingService.toggleStatus(id, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeBuilding' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL], permissions: [ValidPermissions.DELETE_RESIDENCE] })
  async remove(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const result = await this.buildingService.remove(id, currentUser);
    return result.success;
  }

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => PaginatedBuildingsResponse, { name: 'buildings' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.VIEW_RESIDENCES],
  })
  findByComplex(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedBuildingsResponse> {
    return this.buildingService.findByComplex(complexId, pagination, currentUser);
  }

  @Query(() => Building, { name: 'building' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.VIEW_RESIDENCES],
  })
  findOne(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Building> {
    return this.buildingService.findById(id, currentUser);
  }
}
