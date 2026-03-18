import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Unit }                   from '../entities/unit.entity';
import { UnitService }            from '../services/unit.service';
import { CreateUnitInput }        from '../dto/inputs/create-unit.input';
import { UpdateUnitInput }        from '../dto/inputs/update-unit.input';
import { PaginatedUnitsResponse } from '../dto/responses/paginated-units.response';
import { PaginationInput }        from '../../shared/dto/inputs/pagination.input';
import { UnitStatus }             from '../enums/unit-status.enum';
import { Auth }                   from '../../shared/decorators/auth.decorator';
import { CurrentUser }            from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload }       from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }             from '../../roles/enums/valid-roles';
import { ValidPermissions }       from '../../permissions/enums/valid-permissions';

@Resolver(() => Unit)
export class UnitResolver {

  constructor(private readonly unitService: UnitService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  @Mutation(() => Unit, { name: 'createUnit' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL], permissions: [ValidPermissions.CREATE_RESIDENCE] })
  create(
    @Args('input') input: CreateUnitInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Unit> {
    return this.unitService.create(input, currentUser);
  }

  @Mutation(() => Unit, { name: 'updateUnit' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL], permissions: [ValidPermissions.EDIT_RESIDENCE] })
  update(
    @Args('input') input: UpdateUnitInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Unit> {
    return this.unitService.update(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeUnit' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL], permissions: [ValidPermissions.DELETE_RESIDENCE] })
  async remove(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const result = await this.unitService.remove(id, currentUser);
    return result.success;
  }

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => PaginatedUnitsResponse, { name: 'units' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.ACCOUNTANT_ROL,
    ],
    // permissions: [ValidPermissions.VIEW_RESIDENCES],
  })
  findByComplex(
    @Args('complexId')                       complexId: string,
    @Args('pagination', { nullable: true })  pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('buildingId', { nullable: true })  buildingId?: string,
    @Args('status',     { nullable: true, type: () => UnitStatus }) status?: UnitStatus,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ): Promise<PaginatedUnitsResponse> {
    return this.unitService.findByComplex(complexId, pagination, currentUser, buildingId, status);
  }

  @Query(() => Unit, { name: 'unit' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_RESIDENCES],
  })
  findOne(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Unit> {
    return this.unitService.findById(id, currentUser);
  }
}
