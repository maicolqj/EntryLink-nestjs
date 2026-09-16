import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { MaintenanceLocationTag } from '../entities/maintenance-location-tag.entity';
import { MaintenanceLocationsService } from '../services/maintenance-locations.service';
import {
  CreateMaintenanceLocationTagInput,
  UpdateMaintenanceLocationTagInput,
} from '../dto/inputs/maintenance-location-tag.inputs';
import { MaintenanceReportOptionsResponse } from '../dto/responses/maintenance-report-options.response';

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

@RequireModule(ComplexModule.MANTENIMIENTO)
@Resolver(() => MaintenanceLocationTag)
export class MaintenanceLocationsResolver {
  constructor(private readonly locationsService: MaintenanceLocationsService) {}

  @Mutation(() => MaintenanceLocationTag, {
    name: 'createMaintenanceLocationTag',
  })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_LOCATIONS],
  })
  createMaintenanceLocationTag(
    @Args('input') input: CreateMaintenanceLocationTagInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    return this.locationsService.createTag(input, currentUser);
  }

  @Mutation(() => MaintenanceLocationTag, {
    name: 'updateMaintenanceLocationTag',
  })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_LOCATIONS],
  })
  updateMaintenanceLocationTag(
    @Args('input') input: UpdateMaintenanceLocationTagInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    return this.locationsService.updateTag(input, currentUser);
  }

  @Mutation(() => MaintenanceLocationTag, {
    name: 'deactivateMaintenanceLocationTag',
  })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_LOCATIONS],
  })
  deactivateMaintenanceLocationTag(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    return this.locationsService.deactivateTag(id, currentUser);
  }

  @Query(() => [MaintenanceLocationTag], { name: 'maintenanceLocationTags' })
  @Auth({
    roles: [
      ...MANAGER_ROLES,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceLocationTags(
    @Args('complexId') complexId: string,
    @Args('onlyActive', { nullable: true, defaultValue: true })
    onlyActive: boolean,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag[]> {
    return this.locationsService.findTagsByComplex(
      complexId,
      currentUser,
      onlyActive,
    );
  }

  /**
   * Todo lo que el formulario de reporte necesita para dejar señalar el sitio:
   * torres, zonas comunes y puntos con QR/NFC.
   */
  @Query(() => MaintenanceReportOptionsResponse, {
    name: 'maintenanceReportOptions',
  })
  @Auth({
    roles: [
      ...MANAGER_ROLES,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.REPORT_MAINTENANCE_TICKET],
  })
  findMaintenanceReportOptions(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceReportOptionsResponse> {
    return this.locationsService.findReportOptions(complexId, currentUser);
  }

  /**
   * Lo que resuelve el escaneo del QR o del TAG NFC antes de abrir el
   * formulario: la app ya sabe dónde está parado el usuario.
   */
  @Query(() => MaintenanceLocationTag, { name: 'maintenanceLocationTagByCode' })
  @Auth({
    roles: [
      ...MANAGER_ROLES,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.REPORT_MAINTENANCE_TICKET],
  })
  findMaintenanceLocationTagByCode(
    @Args('complexId') complexId: string,
    @Args('code') code: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    return this.locationsService.findTagByCode(complexId, code, currentUser);
  }
}
