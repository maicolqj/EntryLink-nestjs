import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Package }                   from '../entities/package.entity';
import { PackagesService }           from '../services/packages.service';
import { RegisterPackageInput }      from '../dto/inputs/register-package.input';
import { ConfirmDeliveryInput }      from '../dto/inputs/confirm-delivery.input';
import { FilterPackagesInput }       from '../dto/inputs/filter-packages.input';
import { PaginatedPackagesResponse } from '../dto/responses/paginated-packages.response';
import { PaginationInput }           from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => Package)
export class PackagesResolver {

  constructor(private readonly packagesService: PackagesService) {}

  // ================================================================
  // MUTATIONS — Registro y ciclo de vida
  // ================================================================

  /**
   * Registra un paquete recibido en portería.
   * Puede hacerlo el guarda o el supervisor del complejo.
   */
  @Mutation(() => Package, { name: 'registerPackage' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.CREATE_PACKAGE],
  })
  register(
    @Args('input') input: RegisterPackageInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Package> {
    return this.packagesService.register(input, currentUser);
  }

  /**
   * Marca el paquete como notificado al residente.
   */
  @Mutation(() => Package, { name: 'markPackageAsNotified' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, 
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.EDIT_PACKAGE],  
  })
  markAsNotified(
    @Args('packageId') packageId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Package> {
    return this.packagesService.markAsNotified(packageId, currentUser);
  }

  /**
   * Confirma la entrega del paquete al residente (o representante).
   */
  @Mutation(() => Package, { name: 'confirmPackageDelivery' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.MANAGE_PACKAGES],
  })
  confirmDelivery(
    @Args('input') input: ConfirmDeliveryInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Package> {
    return this.packagesService.confirmDelivery(input, currentUser);
  } 

  /**
   * Registra la devolución de un paquete al remitente.
   */
  @Mutation(() => Package, { name: 'returnPackage' })
  @Auth({ 
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.MANAGE_PACKAGES],
  })
  returnPackage(
    @Args('packageId') packageId: string,
    @Args('reason')    reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Package> {
    return this.packagesService.returnPackage(packageId, reason, currentUser);
  }

  /**
   * Marca el paquete como perdido (LOST).
   */
  @Mutation(() => Package, { name: 'markPackageAsLost' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_PACKAGES],
  })
  markAsLost(
    @Args('packageId') packageId: string,
    @Args('reason')    reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Package> {
    return this.packagesService.markAsLost(packageId, reason, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista todos los paquetes del complejo con filtros y paginación.
   */
  @Query(() => PaginatedPackagesResponse, { name: 'packages' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
      ValidRoles.ACCOUNTANT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PACKAGES],
  })
  findByComplex(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterPackagesInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedPackagesResponse> {
    return this.packagesService.findByComplex(complexId, pagination, filters, currentUser);
  }

  /**
   * Paquetes pendientes (sin retirar) de una unidad específica.
   */
  @Query(() => [Package], { name: 'pendingPackagesByUnit' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PACKAGES],
  })
  findPendingByUnit(
    @Args('unitId')    unitId: string,
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Package[]> {
    return this.packagesService.findPendingByUnit(unitId, complexId, currentUser);
  }

  /**
   * Detalle de un paquete por ID.
   */
  @Query(() => Package, { name: 'package' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PACKAGES],
  })
  findOne(
    @Args('packageId') packageId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Package> {
    return this.packagesService.findById(packageId, currentUser);
  }
}
