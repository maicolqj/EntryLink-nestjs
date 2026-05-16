import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Visit }                  from '../entities/visit.entity';
import { VisitsService }          from '../services/visits.service';
import { RegisterWalkInInput }    from '../dto/inputs/register-walk-in.input';
import { ScheduleVisitInput }     from '../dto/inputs/schedule-visit.input';
import { FilterVisitsInput }      from '../dto/inputs/filter-visits.input';
import { PaginatedVisitsResponse } from '../dto/responses/paginated-visits.response';
import { QrValidationResponse }   from '../dto/responses/qr-validation.response';
import { PaginationInput }        from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => Visit)
export class VisitsResolver {

  constructor(private readonly visitsService: VisitsService) {}

  // ================================================================
  // MUTATIONS — SEGURIDAD (SECURITY_ROL)
  // ================================================================

  /**
   * El guardia registra la llegada de un visitante sin cita previa.
   * Queda en PENDING_APPROVAL hasta que el residente responda.
   */
  @Mutation(() => Visit, { name: 'registerWalkIn' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.REGISTER_VISITOR_ENTRY],
  })
  registerWalkIn(
    @Args('input') input: RegisterWalkInInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.registerWalkIn(input, currentUser);
  }

  /**
   * El guardia valida y usa un QR de acceso.
   * Si es válido, registra la entrada automáticamente.
   */
  @Mutation(() => QrValidationResponse, { name: 'validateQrAccess' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.REGISTER_VISITOR_ENTRY],
  })
  validateQrAccess(
    @Args('qrToken') qrToken: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<QrValidationResponse> {
    return this.visitsService.validateAndUseQr(qrToken, currentUser);
  }

  /**
   * El guardia registra la entrada física (cuando ya fue aprobada manualmente).
   */
  @Mutation(() => Visit, { name: 'registerVisitorEntry' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.REGISTER_VISITOR_ENTRY],
  })
  registerEntry(
    @Args('visitId') visitId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.registerEntry(visitId, currentUser);
  }

  /**
   * El guardia registra la salida del visitante.
   */
  @Mutation(() => Visit, { name: 'registerVisitorExit' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL, ValidRoles.COMPLEX_ROL ],
    permissions: [ValidPermissions.REGISTER_VISITOR_EXIT],
  })
  registerExit(
    @Args('visitId')            visitId: string,
    @Args('notes', { nullable: true }) notes?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.registerExit(visitId, currentUser, notes);
  }

  // ================================================================
  // MUTATIONS — RESIDENTE (RESIDENT_ROL)
  // ================================================================

  /**
   * El residente pre-autoriza una visita y genera un QR de acceso.
   */
  @Mutation(() => Visit, { name: 'scheduleVisit' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.SCHEDULE_VISIT],
  })
  scheduleVisit(
    @Args('input') input: ScheduleVisitInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.scheduleVisit(input, currentUser);
  }

  /**
   * El residente aprueba la entrada de un visitante en walk-in.
   */
  @Mutation(() => Visit, { name: 'approveVisitEntry' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.APPROVE_VISIT],
  })
  approveVisitEntry(
    @Args('visitId') visitId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.approveVisitEntry(visitId, currentUser);
  }

  /**
   * El residente deniega la entrada de un visitante en walk-in.
   */
  @Mutation(() => Visit, { name: 'denyVisitEntry' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.APPROVE_VISIT],
  })
  denyVisitEntry(
    @Args('visitId') visitId: string,
    @Args('reason')  reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.denyVisitEntry(visitId, reason, currentUser);
  }

  /**
   * Cancela una visita agendada o pendiente.
   */
  @Mutation(() => Visit, { name: 'cancelVisit' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL,
      ValidRoles.COMPLEX_ROL,     ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.SCHEDULE_VISIT],
  })
  cancelVisit(
    @Args('visitId') visitId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.cancelVisit(visitId, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista de visitas del complejo con filtros y paginación.
   */
  @Query(() => PaginatedVisitsResponse, { name: 'visits' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VISITS],
  })
  findByComplex(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterVisitsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedVisitsResponse> {
    return this.visitsService.findByComplex(complexId, pagination, filters, currentUser);
  }

  /**
   * Visitantes que están DENTRO del complejo en este momento.
   * Panel en tiempo real del guardia.
   */
  @Query(() => [Visit], { name: 'activeVisits' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VISITS],
  })
  findActiveVisits(
    @Args('complexId') complexId: string,
  ): Promise<Visit[]> {
    return this.visitsService.findActiveVisits(complexId);
  }

  /**
   * Visitas esperando aprobación del residente.
   */
  @Query(() => [Visit], { name: 'pendingApprovalVisits' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VISITS],
  })
  findPendingApproval(
    @Args('complexId') complexId: string,
  ): Promise<Visit[]> {
    return this.visitsService.findPendingApproval(complexId);
  }

  /**
   * Visitas programadas para hoy — útil para preparar la portería.
   */
  @Query(() => [Visit], { name: 'scheduledVisitsToday' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.COMPLEX_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VISITS],
  })
  findScheduledToday(
    @Args('complexId') complexId: string,
  ): Promise<Visit[]> {
    return this.visitsService.findScheduledToday(complexId);
  }

  /**
   * Detalle de una visita por ID.
   */
  @Query(() => Visit, { name: 'visit' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
    permissions: [ValidPermissions.VIEW_VISITS],
  })
  findOne(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Visit> {
    return this.visitsService.findById(id, currentUser);
  }
}
 