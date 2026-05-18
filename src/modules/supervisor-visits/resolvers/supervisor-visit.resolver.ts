import { Resolver, Mutation, Query, Args, Int } from '@nestjs/graphql';

import { SupervisorVisitService } from '../services/supervisor-visit.service';
import { SupervisorAccessRequestService } from '../services/supervisor-access-request.service';
import { SupervisorVisit } from '../entities/supervisor-visit.entity';
import { SupervisorAccessRequest } from '../entities/supervisor-access-request.entity';
import { SupervisorVisitStatus } from '../enums/supervisor-visit-status.enum';
import { SupervisorCheckInInput } from '../dto/inputs/supervisor-checkin.input';
import { SupervisorCheckOutInput } from '../dto/inputs/supervisor-checkout.input';
import { RequestComplexAccessInput } from '../dto/inputs/request-complex-access.input';
import { RejectAccessRequestInput } from '../dto/inputs/resolve-access-request.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Auth } from '../../shared/decorators/auth.decorator';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

@Resolver()
export class SupervisorVisitResolver {
  constructor(
    private readonly supervisorVisitService: SupervisorVisitService,
    private readonly accessRequestService: SupervisorAccessRequestService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // CHECK-IN / CHECK-OUT
  // ════════════════════════════════════════════════════════════════

  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  @Mutation(() => SupervisorVisit, {
    name: 'supervisorCheckIn',
    description:
      'Registra el check-in del supervisor en un complejo residencial. ' +
      'Requiere asignación activa al complejo y validación GPS. ' +
      'Solo puede existir una visita ACTIVA por complejo a la vez.',
  })
  supervisorCheckIn(
    @Args('input') input: SupervisorCheckInInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorVisit> {
    return this.supervisorVisitService.checkIn(input, currentUser);
  }

  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  @Mutation(() => SupervisorVisit, {
    name: 'supervisorCheckOut',
    description:
      'Registra el check-out del supervisor. Cierra la visita activa (status: CLOSED).',
  })
  supervisorCheckOut(
    @Args('input') input: SupervisorCheckOutInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorVisit> {
    return this.supervisorVisitService.checkOut(input, currentUser);
  }

  // ════════════════════════════════════════════════════════════════
  // SOLICITUDES DE ACCESO — SUPERVISOR
  // ════════════════════════════════════════════════════════════════

  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  @Mutation(() => SupervisorAccessRequest, {
    name: 'requestComplexAccess',
    description:
      'El supervisor solicita acceso a un complejo al que no está asignado. ' +
      'El administrador del complejo recibe la solicitud y puede aprobarla o rechazarla remotamente.',
  })
  requestComplexAccess(
    @Args('input') input: RequestComplexAccessInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    return this.accessRequestService.requestAccess(input, currentUser);
  }

  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  @Query(() => [SupervisorAccessRequest], {
    name: 'myAccessRequests',
    description: 'Retorna el historial de solicitudes de acceso del supervisor (últimas 50).',
  })
  findMyAccessRequests(
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest[]> {
    return this.accessRequestService.findMyRequests(currentUser.sub);
  }

  // ════════════════════════════════════════════════════════════════
  // SOLICITUDES DE ACCESO — COMPLEX_ROL / SUPER_ADMIN
  // ════════════════════════════════════════════════════════════════

  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  @Query(() => [SupervisorAccessRequest], {
    name: 'pendingAccessRequests',
    description:
      'Retorna las solicitudes de acceso PENDIENTES para un complejo. ' +
      'Permite al COMPLEX_ROL gestionar los supervisores que solicitan acceso.',
  })
  findPendingRequests(
    @Args('complexId', { type: () => String }) complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest[]> {
    return this.accessRequestService.findPendingForComplex(complexId, currentUser);
  }

  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  @Mutation(() => SupervisorAccessRequest, {
    name: 'approveAccessRequest',
    description:
      'Aprueba la solicitud de acceso de un supervisor. ' +
      'Crea automáticamente la asignación UserComplexAssignment (ACTIVE). ' +
      'El supervisor podrá hacer check-in inmediatamente después.',
  })
  approveAccessRequest(
    @Args('requestId', { type: () => String }) requestId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    return this.accessRequestService.approveRequest(requestId, currentUser);
  }

  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  @Mutation(() => SupervisorAccessRequest, {
    name: 'rejectAccessRequest',
    description: 'Rechaza la solicitud de acceso de un supervisor con un motivo opcional.',
  })
  rejectAccessRequest(
    @Args('input') input: RejectAccessRequestInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    return this.accessRequestService.rejectRequest(input, currentUser);
  }

  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  @Query(() => Int, {
    name: 'pendingAccessRequestsCount',
    description:
      'Retorna el número de solicitudes de acceso PENDIENTES para un complejo. ' +
      'Úsalo para mostrar el badge numérico en la sección Supervisores del panel.',
  })
  countPendingAccessRequests(
    @Args('complexId', { type: () => String }) complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<number> {
    return this.accessRequestService.countPendingRequests(complexId, currentUser);
  }

  // ════════════════════════════════════════════════════════════════
  // CONSULTAS DE VISITAS Y COMPLEJOS ASIGNADOS
  // ════════════════════════════════════════════════════════════════

  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  @Query(() => [SupervisorVisit], {
    name: 'mySupervisorVisits',
    description: 'Retorna las últimas 50 visitas del supervisor. Filtrable por estado.',
  })
  findMyVisits(
    @CurrentUser() currentUser: JwtAccessPayload,
    @Args('status', { type: () => SupervisorVisitStatus, nullable: true })
    status?: SupervisorVisitStatus,
  ): Promise<SupervisorVisit[]> {
    return this.supervisorVisitService.findMyVisits(currentUser.sub, status);
  }

  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  @Query(() => SupervisorVisit, {
    name: 'activeSupervisorVisit',
    nullable: true,
    description: 'Retorna la visita activa del supervisor en el complejo indicado, o null.',
  })
  findActiveVisit(
    @Args('complexId', { type: () => String }) complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SupervisorVisit | null> {
    return this.supervisorVisitService.findActiveVisit(complexId, currentUser.sub);
  }

  @Auth({ roles: [ValidRoles.SUPERVISOR_ROL] })
  @Query(() => [ResidentialComplex], {
    name: 'myAssignedComplexes',
    description:
      'Retorna los complejos con asignación activa del supervisor. ' +
      'Solo puede hacer check-in en estos complejos.',
  })
  findAssignedComplexes(
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex[]> {
    return this.supervisorVisitService.findAssignedComplexes(currentUser.sub);
  }
}
