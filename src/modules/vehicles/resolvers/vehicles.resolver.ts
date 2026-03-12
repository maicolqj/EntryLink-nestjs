import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Vehicle }                   from '../entities/vehicle.entity';
import { VehiclesService }           from '../services/vehicles.service';
import { RegisterVehicleInput }      from '../dto/inputs/register-vehicle.input';
import { UpdateVehicleInput }        from '../dto/inputs/update-vehicle.input';
import { FilterVehiclesInput }       from '../dto/inputs/filter-vehicles.input';
import { ApproveVehicleInput }       from '../dto/inputs/approve-vehicle.input';
import { PaginatedVehiclesResponse } from '../dto/responses/paginated-vehicles.response';
import { PlateCheckResponse }        from '../dto/responses/plate-check.response';
import { PaginationInput }           from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => Vehicle)
export class VehiclesResolver {

  constructor(private readonly vehiclesService: VehiclesService) {}

  // ================================================================
  // MUTATIONS — Registro
  // ================================================================

  /**
   * Registra un vehículo en el complejo.
   * Puede hacerlo el administrador del complejo o el propio residente.
   * El vehículo queda en PENDING_APPROVAL.
   */
  @Mutation(() => Vehicle, { name: 'registerVehicle' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.REGISTER_VEHICLE],
  })
  register(
    @Args('input') input: RegisterVehicleInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    return this.vehiclesService.register(input, currentUser);
  }

  /**
   * Actualiza datos del vehículo (foto, color, parqueadero, notas).
   * La placa NO se puede cambiar.
   */
  @Mutation(() => Vehicle, { name: 'updateVehicle' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.EDIT_VEHICLE],
  })
  update(
    @Args('input') input: UpdateVehicleInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    return this.vehiclesService.update(input, currentUser);
  }

  // ================================================================
  // MUTATIONS — Flujo de aprobación (COMPLEX_ROL / SUPERVISOR_ROL)
  // ================================================================

  /**
   * Aprueba un vehículo pendiente — lo activa para circular en el complejo.
   */
  @Mutation(() => Vehicle, { name: 'approveVehicle' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.APPROVE_VEHICLE],
  })
  approve(
    @Args('input') input: ApproveVehicleInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    return this.vehiclesService.approve(input, currentUser);
  }

  /**
   * Rechaza un vehículo pendiente (documentos inválidos, fraude, etc.).
   */
  @Mutation(() => Vehicle, { name: 'rejectVehicle' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.APPROVE_VEHICLE],
  })
  reject(
    @Args('vehicleId') vehicleId: string,
    @Args('reason')    reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    return this.vehiclesService.reject(vehicleId, reason, currentUser);
  }

  /**
   * Suspende un vehículo activo (morosidad, infracción de normas).
   */
  @Mutation(() => Vehicle, { name: 'suspendVehicle' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.APPROVE_VEHICLE],
  })
  suspend(
    @Args('vehicleId') vehicleId: string,
    @Args('reason')    reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    return this.vehiclesService.suspend(vehicleId, reason, currentUser);
  }

  /**
   * Reactiva un vehículo suspendido.
   */
  @Mutation(() => Vehicle, { name: 'reactivateVehicle' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.APPROVE_VEHICLE],
  })
  reactivate(
    @Args('vehicleId') vehicleId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    return this.vehiclesService.reactivate(vehicleId, currentUser);
  }

  /**
   * Retira el vehículo del complejo definitivamente (residente se mudó, vendió el carro, etc.).
   */
  @Mutation(() => Boolean, { name: 'removeVehicle' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.REMOVE_VEHICLE],
  })
  async remove(
    @Args('vehicleId') vehicleId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const result = await this.vehiclesService.remove(vehicleId, currentUser);
    return result.success;
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista todos los vehículos del complejo con filtros y paginación.
   */
  @Query(() => PaginatedVehiclesResponse, { name: 'vehicles' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
      ValidRoles.ACCOUNTANT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VEHICLES],
  })
  findByComplex(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterVehiclesInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedVehiclesResponse> {
    return this.vehiclesService.findByComplex(complexId, pagination, filters, currentUser);
  }

  /**
   * Vehículos de un residente específico.
   */
  @Query(() => [Vehicle], { name: 'vehiclesByResident' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VEHICLES],
  })
  findByResident(
    @Args('residentId') residentId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle[]> {
    return this.vehiclesService.findByResident(residentId, currentUser);
  }

  /**
   * Vehículos pendientes de aprobación — panel del administrador del complejo.
   */
  @Query(() => [Vehicle], { name: 'pendingVehicles' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.APPROVE_VEHICLE],
  })
  findPending(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle[]> {
    return this.vehiclesService.findPending(complexId, currentUser);
  }

  /**
   * Consulta rápida de placa — herramienta del guardia de seguridad.
   * Devuelve si el vehículo está registrado, su estado y datos del residente.
   */
  @Query(() => PlateCheckResponse, { name: 'checkPlate' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.COMPLEX_ROL,
    ],
    permissions: [ValidPermissions.CHECK_PLATE],
  })
  checkPlate(
    @Args('plate')     plate: string,
    @Args('complexId') complexId: string,
  ): Promise<PlateCheckResponse> {
    return this.vehiclesService.checkPlate(plate, complexId);
  }

  /**
   * Detalle de un vehículo por ID.
   */
  @Query(() => Vehicle, { name: 'vehicle' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VEHICLES],
  })
  findOne(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Vehicle> {
    return this.vehiclesService.findById(id, currentUser);
  }
}
