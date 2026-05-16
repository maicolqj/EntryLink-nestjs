import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { VisitorVehicle }       from '../entities/visitor-vehicle.entity';
import { VisitorParkingConfig } from '../entities/visitor-parking-config.entity';
import { VisitorParkingService } from '../services/visitor-parking.service';

import { SetParkingRateInput }                 from '../dto/inputs/set-parking-rate.input';
import { RegisterVisitorVehicleInput }         from '../dto/inputs/register-visitor-vehicle.input';
import { FilterVisitorVehiclesInput }          from '../dto/inputs/filter-visitor-vehicles.input';
import { UpdateVisitorParkingConfigInput }     from '../dto/inputs/update-visitor-parking-config.input';
import { PaginatedVisitorVehiclesResponse }    from '../dto/responses/paginated-visitor-vehicles.response';
import { PaginationInput }                     from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { VisitorParkingRate } from '../entities/visitor-parking-rate.entity';
import { ResgiterExitVehicle } from '../dto/inputs/register-exit-vehicle.input';
import { ParkingRateType } from '../enums/parking-rate-type.enum';

@Resolver()
export class VisitorParkingResolver {

  constructor(private readonly parkingService: VisitorParkingService) {}

  // ================================================================
  // QUERIES — Configuración parqueadero visitante
  // ================================================================

  /**
   * Retorna la configuración del parqueadero visitante para un complejo.
   * Devuelve null si aún no existe configuración.
   */
  @Query(() => VisitorParkingConfig, { name: 'visitorParkingConfig', nullable: true })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.COMPLEX_ROL,
      // ValidRoles.ACCOUNTANT_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
    ],
  })
  getVisitorParkingConfig(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingConfig | null> {
    return this.parkingService.getVisitorParkingConfig(complexId, currentUser);
  }

  // ================================================================
  // MUTATIONS — Configuración parqueadero visitante
  // ================================================================

  /**
   * Crea o actualiza la configuración del parqueadero visitante (upsert).
   * Las tarifas incluidas se crean o actualizan según si traen ID.
   */
  @Mutation(() => VisitorParkingConfig, { name: 'updateVisitorParkingConfig' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
  })
  updateVisitorParkingConfig(
    @Args('input') input: UpdateVisitorParkingConfigInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingConfig> {
    return this.parkingService.updateVisitorParkingConfig(input, currentUser);
  }

  // ================================================================
  // MUTATIONS — Tarifas
  // ================================================================

  /**
   * Crea o actualiza la tarifa de parqueadero para un tipo de vehículo.
   * Si ya existe una tarifa para ese tipo en el complejo, la actualiza.
   * Roles: Administrador del complejo, Contador, Super Admin.
   */
  @Mutation(() => VisitorParkingConfig, { name: 'setParkingRate' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
    ],
  })
  setParkingRate(
    @Args('input') input: SetParkingRateInput,
    @CurrentUser() currentUser: JwtAccessPayload, 
  ): Promise<VisitorParkingRate> {
    return this.parkingService.setParkingRate(input, currentUser);
  }

  /**
   * Activa o desactiva una tarifa existente sin eliminarla.
   * Roles: Administrador del complejo, Super Admin.
   */
  @Mutation(() => VisitorParkingConfig, { name: 'toggleParkingRate' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
  })
  toggleParkingRate(
    @Args('rateId') rateId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingRate> {
    return this.parkingService.toggleParkingRate(rateId, currentUser);
  }

  // ================================================================
  // MUTATIONS — Vehículos visitantes
  // ================================================================

  /**
   * Registra el ingreso de un vehículo visitante al parqueadero.
   * Valida que el residente anfitrión esté activo.
   * Roles: Guardia de seguridad, Administrador, Super Admin.
   */
  @Mutation(() => VisitorVehicle, { name: 'registerVisitorVehicleEntry' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  registerEntry(
    @Args('input') input: RegisterVisitorVehicleInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    return this.parkingService.registerEntry(input, currentUser);
  }

  /**
   * Registra la salida del vehículo y genera automáticamente el cobro
   * basado en el tiempo transcurrido y la tarifa vigente del complejo.
   * Fórmula: ceil(minutos / 60) × tarifa_por_hora.
   * Roles: Guardia de seguridad, Administrador, Super Admin.
   */
  @Mutation(() => VisitorVehicle, { name: 'registerVisitorVehicleExit' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  registerExit(
    @Args('input') input: ResgiterExitVehicle,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    return this.parkingService.registerExit(input, currentUser);
  }

  /**
   * Cancela un registro de ingreso (por error de captura u otro motivo).
   * Solo se pueden cancelar registros en estado INSIDE.
   * Roles: Administrador del complejo, Super Admin.
   */
  @Mutation(() => VisitorVehicle, { name: 'cancelVisitorVehicleEntry' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
  })
  cancelEntry(
    @Args('visitorVehicleId') visitorVehicleId: string,
    @Args('cancellationReason') cancellationReason: string, 
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    return this.parkingService.cancelEntry(visitorVehicleId, cancellationReason, currentUser);
  }

  // ================================================================
  // QUERIES — Tarifas
  // ================================================================

  /**
   * Lista todas las tarifas de parqueadero configuradas en el complejo.
   */
  @Query(() => [VisitorParkingRate], { name: 'parkingRates' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  getParkingRates(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorParkingRate[]> {
    return this.parkingService.getParkingRates(complexId, currentUser);
  }

  // ================================================================
  // QUERIES — Vehículos visitantes
  // ================================================================

  /**
   * Lista los vehículos que actualmente están dentro del parqueadero (INSIDE).
   * Útil para el guardia en turno.
   */
  @Query(() => [VisitorVehicle], { name: 'activeVisitorVehicles' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  findActive(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle[]> {
    return this.parkingService.findActive(complexId, currentUser);
  }

  /**
   * Historial paginado de vehículos visitantes con filtros por estado,
   * tipo, placa, residente anfitrión y rango de fechas.
   */
  @Query(() => PaginatedVisitorVehiclesResponse, { name: 'visitorVehicles' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  findAll(
    @Args('filters') filters: FilterVisitorVehiclesInput,
    @Args('pagination', { defaultValue: { page: 1, limit: 10 } }) pagination: PaginationInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedVisitorVehiclesResponse> {
    return this.parkingService.findAll(filters, pagination, currentUser);
  }

  /**
   * Obtiene el detalle de un registro de parqueadero por su ID.
   */
  @Query(() => VisitorVehicle, { name: 'visitorVehicle' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
    ],
  })
  findById(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VisitorVehicle> {
    return this.parkingService.findById(id, currentUser);
  }
}
