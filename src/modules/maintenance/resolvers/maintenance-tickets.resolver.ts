import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { MaintenanceTicket } from '../entities/maintenance-ticket.entity';
import { MaintenanceTicketsService } from '../services/maintenance-tickets.service';

import { TriageMaintenanceTicketInput } from '../dto/inputs/triage-maintenance-ticket.input';
import { AssignMaintenanceTicketInput } from '../dto/inputs/assign-maintenance-ticket.input';
import { ChangeMaintenanceStatusInput } from '../dto/inputs/change-maintenance-status.input';
import { AddMaintenanceCommentInput } from '../dto/inputs/add-maintenance-comment.input';
import { RateMaintenanceTicketInput } from '../dto/inputs/rate-maintenance-ticket.input';
import { FilterMaintenanceTicketsInput } from '../dto/inputs/filter-maintenance-tickets.input';
import { CheckMaintenanceDuplicateInput } from '../dto/inputs/check-maintenance-duplicate.input';
import { PaginatedMaintenanceTicketsResponse } from '../dto/responses/paginated-maintenance-tickets.response';
import { MaintenanceBoardResponse } from '../dto/responses/maintenance-board.response';
import { MaintenanceMapPinResponse } from '../dto/responses/maintenance-map-pin.response';
import { MaintenanceHeatmapCell } from '../dto/responses/maintenance-heatmap.response';
import { MaintenanceStatsResponse } from '../dto/responses/maintenance-stats.response';
import { MaintenanceStaffMember } from '../dto/responses/maintenance-staff-member.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
/** Quien gestiona el tablero. */
const MANAGER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
];

/** Quien lo consulta: el personal más quien reporta desde la app. */
const READER_ROLES = [
  ...MANAGER_ROLES,
  ValidRoles.SECURITY_ROL,
  ValidRoles.RESIDENT_ROL,
  ValidRoles.COUNCIL_ROL,
];

/**
 * La radicación NO está aquí: va por REST
 * (POST /api/v1/maintenance/tickets) porque las fotos y el video viajan en la
 * misma petición y el servidor les pone el sello de hora y el hash.
 */
@RequireModule(ComplexModule.MANTENIMIENTO)
@Resolver(() => MaintenanceTicket)
export class MaintenanceTicketsResolver {
  constructor(private readonly ticketsService: MaintenanceTicketsService) {}

  // ================================================================
  // MUTATIONS — trámite de la administración
  // ================================================================

  @Mutation(() => MaintenanceTicket, { name: 'triageMaintenanceTicket' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_TICKETS],
  })
  triageMaintenanceTicket(
    @Args('input') input: TriageMaintenanceTicketInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.triage(input, currentUser);
  }

  /** Personal de aseo y mantenimiento que se le puede asignar a un ticket. */
  @Query(() => [MaintenanceStaffMember], { name: 'maintenanceStaff' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_TICKETS],
  })
  findMaintenanceStaff(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceStaffMember[]> {
    return this.ticketsService.findMaintenanceStaff(complexId, currentUser);
  }

  @Mutation(() => MaintenanceTicket, { name: 'assignMaintenanceTicket' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_TICKETS],
  })
  assignMaintenanceTicket(
    @Args('input') input: AssignMaintenanceTicketInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.assign(input, currentUser);
  }

  /** Mover la tarjeta entre columnas. También lo usa el personal asignado. */
  @Mutation(() => MaintenanceTicket, { name: 'changeMaintenanceTicketStatus' })
  @Auth({
    roles: [...MANAGER_ROLES, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_TICKETS],
  })
  changeMaintenanceTicketStatus(
    @Args('input') input: ChangeMaintenanceStatusInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.changeStatus(input, currentUser);
  }

  @Mutation(() => MaintenanceTicket, { name: 'rejectMaintenanceTicket' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_TICKETS],
  })
  rejectMaintenanceTicket(
    @Args('ticketId') ticketId: string,
    @Args('reason') reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.reject(ticketId, reason, currentUser);
  }

  @Mutation(() => MaintenanceTicket, { name: 'markMaintenanceTicketDuplicate' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.MANAGE_MAINTENANCE_TICKETS],
  })
  markMaintenanceTicketDuplicate(
    @Args('ticketId') ticketId: string,
    @Args('originalTicketId') originalTicketId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.markDuplicate(
      ticketId,
      originalTicketId,
      currentUser,
    );
  }

  /** Cierre administrativo de un ticket reparado que nadie confirmó. */
  @Mutation(() => MaintenanceTicket, { name: 'closeMaintenanceTicket' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.CLOSE_MAINTENANCE_TICKET],
  })
  closeMaintenanceTicket(
    @Args('ticketId') ticketId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.close(ticketId, currentUser);
  }

  // ================================================================
  // MUTATIONS — residente
  // ================================================================

  /** "A mí también me pasa": suma al ticket en vez de abrir otro. */
  @Mutation(() => MaintenanceTicket, { name: 'endorseMaintenanceTicket' })
  @Auth({
    roles: READER_ROLES,
    permissions: [ValidPermissions.REPORT_MAINTENANCE_TICKET],
  })
  endorseMaintenanceTicket(
    @Args('ticketId') ticketId: string,
    @Args('comment', { nullable: true }) comment: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.endorse(ticketId, comment, currentUser);
  }

  /** Comentario en la bitácora. Las fotos de avance van por REST. */
  @Mutation(() => MaintenanceTicket, { name: 'addMaintenanceComment' })
  @Auth({
    roles: READER_ROLES,
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  addMaintenanceComment(
    @Args('input') input: AddMaintenanceCommentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.addComment(input, currentUser);
  }

  /** Calificar cierra el ticket: es la confirmación de quien reportó. */
  @Mutation(() => MaintenanceTicket, { name: 'rateMaintenanceTicket' })
  @Auth({
    roles: [ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL],
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  rateMaintenanceTicket(
    @Args('input') input: RateMaintenanceTicketInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.rate(input, currentUser);
  }

  /** El arreglo no sirvió: vuelve al tablero con el mismo número. */
  @Mutation(() => MaintenanceTicket, { name: 'reopenMaintenanceTicket' })
  @Auth({
    roles: READER_ROLES,
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  reopenMaintenanceTicket(
    @Args('ticketId') ticketId: string,
    @Args('reason') reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.reopen(ticketId, reason, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => PaginatedMaintenanceTicketsResponse, {
    name: 'maintenanceTickets',
  })
  @Auth({
    roles: READER_ROLES,
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceTickets(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true })
    pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters', { nullable: true })
    filters: FilterMaintenanceTicketsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedMaintenanceTicketsResponse> {
    return this.ticketsService.findByComplex(
      complexId,
      pagination,
      filters,
      currentUser,
    );
  }

  @Query(() => MaintenanceTicket, { name: 'maintenanceTicket' })
  @Auth({
    roles: READER_ROLES,
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findOneMaintenanceTicket(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket> {
    return this.ticketsService.findById(id, currentUser);
  }

  /** El Kanban de la administración, ya agrupado por columna. */
  @Query(() => MaintenanceBoardResponse, { name: 'maintenanceBoard' })
  @Auth({
    roles: [...MANAGER_ROLES, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceBoard(
    @Args('complexId') complexId: string,
    @Args('filters', { nullable: true })
    filters: FilterMaintenanceTicketsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceBoardResponse> {
    return this.ticketsService.board(complexId, filters, currentUser);
  }

  /** Puntos del mapa. Liviano a propósito: el detalle se pide al tocar el pin. */
  @Query(() => [MaintenanceMapPinResponse], { name: 'maintenanceMapPins' })
  @Auth({
    roles: [...MANAGER_ROLES, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceMapPins(
    @Args('complexId') complexId: string,
    @Args('filters', { nullable: true })
    filters: FilterMaintenanceTicketsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceMapPinResponse[]> {
    return this.ticketsService.mapPins(complexId, filters, currentUser);
  }

  /** Dónde se daña siempre lo mismo. */
  @Query(() => [MaintenanceHeatmapCell], { name: 'maintenanceHeatmap' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceHeatmap(
    @Args('complexId') complexId: string,
    @Args('days', { type: () => Int, nullable: true, defaultValue: 90 })
    days: number,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceHeatmapCell[]> {
    return this.ticketsService.heatmap(complexId, days, currentUser);
  }

  @Query(() => MaintenanceStatsResponse, { name: 'maintenanceStats' })
  @Auth({
    roles: MANAGER_ROLES,
    permissions: [ValidPermissions.VIEW_MAINTENANCE_TICKETS],
  })
  findMaintenanceStats(
    @Args('complexId') complexId: string,
    @Args('days', { type: () => Int, nullable: true, defaultValue: 90 })
    days: number,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceStatsResponse> {
    return this.ticketsService.stats(complexId, days, currentUser);
  }

  /**
   * Se consulta antes de abrir el formulario: si el daño ya está reportado, la
   * app ofrece sumarse en vez de crear el ticket número treinta del mismo
   * ascensor.
   */
  @Query(() => [MaintenanceTicket], { name: 'maintenanceDuplicateCandidates' })
  @Auth({
    roles: READER_ROLES,
    permissions: [ValidPermissions.REPORT_MAINTENANCE_TICKET],
  })
  findMaintenanceDuplicateCandidates(
    @Args('input') input: CheckMaintenanceDuplicateInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MaintenanceTicket[]> {
    return this.ticketsService.findDuplicateCandidates(
      input.complexId,
      input.category,
      input,
      currentUser,
    );
  }
}
