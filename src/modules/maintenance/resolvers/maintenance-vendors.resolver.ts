import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { MaintenanceVendor } from '../entities/maintenance-vendor.entity';
import { MaintenanceSlaConfig } from '../entities/maintenance-sla-config.entity';
import { MaintenanceVendorsService } from '../services/maintenance-vendors.service';
import { MaintenanceSlaService } from '../services/maintenance-sla.service';
import {
  CreateMaintenanceVendorInput,
  UpdateMaintenanceVendorInput,
} from '../dto/inputs/maintenance-vendor.inputs';
import { UpsertMaintenanceSlaInput } from '../dto/inputs/upsert-maintenance-sla.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
const MANAGER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
];

/** Proveedores y política de plazos: la configuración del módulo. */
@RequireModule(ComplexModule.MANTENIMIENTO)
@Resolver(() => MaintenanceVendor)
export class MaintenanceVendorsResolver {
  constructor(
    private readonly vendorsService: MaintenanceVendorsService,
    private readonly slaService: MaintenanceSlaService,
  ) {}

  // ================================================================
  // PROVEEDORES
  // ================================================================

  @Mutation(() => MaintenanceVendor, { name: 'createMaintenanceVendor' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_VENDORS],
  })
  createMaintenanceVendor(
    @Args('input') input: CreateMaintenanceVendorInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceVendor> {
    return this.vendorsService.create(input, currentUser);
  }

  @Mutation(() => MaintenanceVendor, { name: 'updateMaintenanceVendor' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_VENDORS],
  })
  updateMaintenanceVendor(
    @Args('input') input: UpdateMaintenanceVendorInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceVendor> {
    return this.vendorsService.update(input, currentUser);
  }

  @Mutation(() => MaintenanceVendor, { name: 'deactivateMaintenanceVendor' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_VENDORS],
  })
  deactivateMaintenanceVendor(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceVendor> {
    return this.vendorsService.deactivate(id, currentUser);
  }

  @Query(() => [MaintenanceVendor], { name: 'maintenanceVendors' })
  @Auth({
    roles: [...MANAGER_ROLES, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceVendors(
    @Args('complexId') complexId: string,
    @Args('onlyActive', { nullable: true, defaultValue: true })
    onlyActive: boolean,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceVendor[]> {
    return this.vendorsService.findByComplex(
      complexId,
      currentUser,
      onlyActive,
    );
  }

  // ================================================================
  // POLÍTICA DE PLAZOS
  // ================================================================

  @Mutation(() => MaintenanceSlaConfig, { name: 'upsertMaintenanceSla' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_SLA],
  })
  upsertMaintenanceSla(
    @Args('input') input: UpsertMaintenanceSlaInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceSlaConfig> {
    return this.slaService.upsert(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeMaintenanceSla' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_SLA],
  })
  removeMaintenanceSla(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.slaService.remove(id, currentUser);
  }

  @Query(() => [MaintenanceSlaConfig], { name: 'maintenanceSlaConfigs' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceSlaConfigs(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceSlaConfig[]> {
    return this.slaService.findByComplex(complexId, currentUser);
  }
}
