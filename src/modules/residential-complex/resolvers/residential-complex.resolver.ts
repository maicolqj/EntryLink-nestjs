import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { ComplexModule } from '../enums/complex-module.enum';

import { ResidentialComplex } from '../entities/residential-complex.entity';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplexService } from '../services/residential-complex.service';
import { CreateComplexInput } from '../dto/inputs/create-complex.input';
import { UpdateComplexInput } from '../dto/inputs/update-complex.input';
import { FilterComplexInput } from '../dto/inputs/filter-complex.input';
import { PaginatedComplexesResponse } from '../dto/responses/paginated-complexes.response';
import { NearbyComplexResponse } from '../dto/responses/nearby-complex.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { ComplexStatus } from '../enums/complex-status.enum';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser, CurrentUserId } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => ResidentialComplex)
export class ResidentialComplexResolver {

  constructor(
    private readonly complexService: ResidentialComplexService,
  ) { }

  // ================================================================
  // MUTATIONS
  // ================================================================

  /**
   * Crea un nuevo complejo residencial.
   * Solo SUPER_ADMIN puede hacerlo (o el propio gestor si se otorga el permiso).
   */
  @Mutation(() => ResidentialComplex, { name: 'createComplex' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL], permissions: [ValidPermissions.CREATE_RESIDENCE] })
  create(
    @Args('input') input: CreateComplexInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    return this.complexService.create(input, currentUser);
  }

  /**
   * Actualiza los datos de un complejo existente.
   */
  @Mutation(() => ResidentialComplex, { name: 'updateComplex' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL], permissions: [ValidPermissions.EDIT_RESIDENCE] })
  update(
    @Args('input') input: UpdateComplexInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    return this.complexService.update(input, currentUser);
  }

  /**
   * Cambia el estado operativo de un complejo.
   */
  @Mutation(() => ResidentialComplex, { name: 'changeComplexStatus' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL], permissions: [ValidPermissions.TOGGLE_RESIDENCE_STATUS] })
  changeStatus(
    @Args('id') id: string,
    @Args('status', { type: () => ComplexStatus }) status: ComplexStatus,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    return this.complexService.changeStatus(id, status, currentUser);
  }

  /**
   * Elimina (soft delete) un complejo.
   */
  @Mutation(() => Boolean, { name: 'removeComplex' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL], permissions: [ValidPermissions.DELETE_RESIDENCE] })
  async remove(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const result = await this.complexService.remove(id, currentUser);
    return result.success;
  }

  /**
   * Restaura un complejo eliminado.
   */
  @Mutation(() => ResidentialComplex, { name: 'restoreComplex' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  restore(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    return this.complexService.restore(id, currentUser);
  }

  /**
   * Actualiza los módulos habilitados de un complejo.
   * Reemplaza completamente la lista actual de módulos.
   */
  @Mutation(() => ResidentialComplex, { name: 'updateComplexModules' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  updateComplexModules(
    @Args('complexId') complexId: string,
    @Args('modules', { type: () => [ComplexModule] }) modules: ComplexModule[],
  ): Promise<ResidentialComplex> {
    return this.complexService.updateEnabledModules(complexId, modules);
  }

  @Query(() => [ComplexModule], { name: 'availableModules', description: 'Retorna todos los módulos disponibles en el sistema' })
  availableModules(): ComplexModule[] {
    return Object.values(ComplexModule);
  }

  // ================================================================
  // RESOLVE FIELDS
  // ================================================================

  /**
   * Filtra el representante legal eliminado (soft-delete).
   * Si el usuario tiene deletedAt o status DELETED, retorna null
   * en lugar del objeto del usuario eliminado.
   */
  @ResolveField('legalRepresentative', () => User, { nullable: true })
  resolveLegalRepresentative(@Parent() complex: ResidentialComplex): User | null {
    const rep = complex.legalRepresentative;
    if (!rep || rep.deletedAt) return null;
    return rep;
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista todos los complejos con paginación y filtros.
   * SUPER_ADMIN ve todos; COMPLEX_ROL solo ve el suyo.
   */
  @Query(() => PaginatedComplexesResponse, { name: 'complexes' })
  @Auth({
    roles: [
      ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPER_ADMIN_ROL,
  ],
    permissions: [ValidPermissions.VIEW_RESIDENCES]
  })
  findAll(
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 10 },
    @Args('filters', { nullable: true }) filters: FilterComplexInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedComplexesResponse> {
    return this.complexService.findAll(pagination, filters, currentUser);
  }

  /**
   * Obtiene el detalle de un complejo por su ID.
   */
  @Query(() => ResidentialComplex, { name: 'complex' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.VIEW_RESIDENCES],
  })
  findOne(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    return this.complexService.findById(id, currentUser);
  }

  /**
   * Devuelve los complejos activos dentro del radio GPS indicado (por defecto 200 m).
   * Uso principal: el supervisor descubre complejos cercanos para solicitar acceso.
   */
  @Query(() => [NearbyComplexResponse], { name: 'nearbyComplexes' })
  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  findNearby(
    @Args('lat', { type: () => Number }) lat: number,
    @Args('lng', { type: () => Number }) lng: number,
    @Args('radiusMeters', { type: () => Number, nullable: true, defaultValue: 200 }) radiusMeters: number,
  ): Promise<NearbyComplexResponse[]> {
    return this.complexService.findNearby(lat, lng, radiusMeters);
  }
}
