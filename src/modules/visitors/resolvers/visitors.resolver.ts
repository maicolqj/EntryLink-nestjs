import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Visitor }                   from '../entities/visitor.entity';
import { VisitorsService }           from '../services/visitors.service';
import { BlacklistVisitorInput }     from '../dto/inputs/blacklist-visitor.input';
import { PaginatedVisitorsResponse } from '../dto/responses/paginated-visitors.response';
import { PaginationInput }           from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => Visitor)
export class VisitorsResolver {

  constructor(private readonly visitorsService: VisitorsService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  /**
   * Agrega a un visitante a la lista negra del complejo.
   */
  @Mutation(() => Visitor, { name: 'blacklistVisitor' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.BLACKLIST_VISITOR],
  })
  blacklist(
    @Args('input') input: BlacklistVisitorInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visitor> {
    return this.visitorsService.blacklist(input, currentUser);
  }

  /**
   * Remueve a un visitante de la lista negra.
   */
  @Mutation(() => Visitor, { name: 'removeVisitorFromBlacklist' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.BLACKLIST_VISITOR],
  })
  removeFromBlacklist(
    @Args('visitorId') visitorId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visitor> {
    return this.visitorsService.removeFromBlacklist(visitorId, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista todos los visitantes registrados en el complejo.
   */
  @Query(() => PaginatedVisitorsResponse, { name: 'visitors' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VISITORS],
  })
  findByComplex(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('search',     { nullable: true }) search?: string,
    @Args('onlyBlacklisted', { nullable: true }) onlyBlacklisted?: boolean,
    @CurrentUser() _currentUser?: JwtAccessPayload,
  ): Promise<PaginatedVisitorsResponse> {
    return this.visitorsService.findByComplex(complexId, pagination, search, onlyBlacklisted);
  }

  /**
   * Detalle de un visitante por ID.
   */
  @Query(() => Visitor, { name: 'visitor' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VISITORS],
  })
  findOne(
    @Args('id') id: string,
  ): Promise<Visitor> {
    return this.visitorsService.findById(id);
  }
}
