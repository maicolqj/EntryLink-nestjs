import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Resident } from '../entities/resident.entity';
import { ResidentsService } from '../services/residents.service';
import { CreateResidentInput } from '../dto/inputs/create-resident.input';
import { UpdateResidentInput } from '../dto/inputs/update-resident.input';
import { FilterResidentsInput } from '../dto/inputs/filter-residents.input';
import { ApproveResidentInput } from '../dto/inputs/approve-resident.input';
import { RejectResidentInput } from '../dto/inputs/reject-resident.input';
import { MoveOutResidentInput } from '../dto/inputs/move-out-resident.input';
import { PaginatedResidentsResponse } from '../dto/responses/paginated-residents.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => Resident)
export class ResidentsResolver {

  constructor(private readonly residentsService: ResidentsService) { }

  // ================================================================
  // MUTATIONS — Administración del Complejo
  // ================================================================

  /**
   * Registra una nueva solicitud de residencia.
   */
  @Mutation(() => Resident, { name: 'createResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    // permissions: [ValidPermissions.CREATE_RESIDENTS],
  })
  create(
    @Args('input') input: CreateResidentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.create(input, currentUser);
  }

  /**
   * Actualiza datos básicos de un residente (contacto de emergencia, fechas, notas).
   */
  @Mutation(() => Resident, { name: 'updateResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    // permissions: [ValidPermissions.EDIT_RESIDENTS],
  })
  update(
    @Args('input') input: UpdateResidentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.update(input, currentUser);
  }

  /**
   * Suspende un residente activo (morosidad, sanción, etc.).
   */
  @Mutation(() => Resident, { name: 'suspendResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    // permissions: [ValidPermissions.BLOCK_RESIDENTS],
  })
  suspend(
    @Args('residentId') residentId: string,
    @Args('reason') reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.suspend(residentId, reason, currentUser);
  }

  /**
   * Reactiva un residente suspendido.
   */
  @Mutation(() => Resident, { name: 'reactivateResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    // permissions: [ValidPermissions.EDIT_RESIDENTS],
  })
  reactivate(
    @Args('residentId') residentId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.reactivate(residentId, currentUser);
  }

  /**
   * Registra la mudanza de un residente.
   * Si no quedan más residentes activos en la unidad, la unidad queda AVAILABLE.
   */
  @Mutation(() => Resident, { name: 'moveOutResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    // permissions: [ValidPermissions.EDIT_RESIDENTS],
  })
  moveOut(
    @Args('input') input: MoveOutResidentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.moveOut(input, currentUser);
  }

  /**
   * Soft delete de un residente. Solo si NO está activo.
   */
  @Mutation(() => Boolean, { name: 'removeResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.DELETE_RESIDENTS],
  })
  async remove(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const result = await this.residentsService.remove(id, currentUser);
    return result.success;
  }

  // ================================================================
  // MUTATIONS — Flujo de Aprobación (COMPLIANCE_OFFICER)
  // ================================================================

  /**
   * Aprueba una solicitud de residencia pendiente.
   * Activa el residente y marca la unidad como OCCUPIED.
   */
  @Mutation(() => Resident, { name: 'approveResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
    permissions: [ValidPermissions.APPROVE_RESIDENT],
  })
  approve(
    @Args('input') input: ApproveResidentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.approve(input, currentUser);
  }

  /**
   * Rechaza una solicitud de residencia pendiente con una razón obligatoria.
   */
  @Mutation(() => Resident, { name: 'rejectResident' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
    permissions: [ValidPermissions.REJECT_RESIDENT],
  })
  reject(
    @Args('input') input: RejectResidentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.reject(input, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista los residentes de un complejo con filtros y paginación.
   */
  @Query(() => PaginatedResidentsResponse, { name: 'residents' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      // ValidRoles.SUPERVISOR_ROL,
      ValidRoles.ACCOUNTANT_ROL,
      ValidRoles.SECURITY_ROL,
    ],
    // permissions: [ValidPermissions.VIEW_RESIDENTS],
  })
  findByComplex(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters', { nullable: true }) filters: FilterResidentsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedResidentsResponse> {
    return this.residentsService.findByComplex(complexId, pagination, filters, currentUser);
  }

  /**
   * Lista todas las solicitudes PENDING_APPROVAL.
   * Dashboard principal del Compliance Officer.
   */
  @Query(() => PaginatedResidentsResponse, { name: 'pendingResidents' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
    permissions: [ValidPermissions.APPROVE_RESIDENT],
  })
  findPending(
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedResidentsResponse> {
    return this.residentsService.findPending(pagination, currentUser);
  }

  /**
   * Detalle de un residente por ID.
   */
  @Query(() => Resident, { name: 'resident' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.VIEW_RESIDENTS],
  })
  findOne(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident> {
    return this.residentsService.findById(id, currentUser);
  }

  /**
   * Historial completo de residentes de una unidad (propietarios anteriores, inquilinos, etc.).
   */
  @Query(() => [Resident], { name: 'residentHistoryByUnit' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.VIEW_RESIDENTS],
  })
  findHistoryByUnit(
    @Args('unitId') unitId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Resident[]> {
    return this.residentsService.findHistoryByUnit(unitId, currentUser);
  }
}
