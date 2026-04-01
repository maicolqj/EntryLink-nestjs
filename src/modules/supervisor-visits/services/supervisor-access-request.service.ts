import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupervisorAccessRequest } from '../entities/supervisor-access-request.entity';
import { AccessRequestStatus } from '../enums/access-request-status.enum';
import { RequestComplexAccessInput } from '../dto/inputs/request-complex-access.input';
import { RejectAccessRequestInput } from '../dto/inputs/resolve-access-request.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import { assertGpsWithinComplex } from '../../shared/utils/gps.utils';
import { AccessRequestErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import {
  UserComplexAssignment,
  AssignmentStatus,
} from '../../users/entities/user-complex-assignment.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';

@Injectable()
export class SupervisorAccessRequestService {
  private readonly logger = new Logger(SupervisorAccessRequestService.name);

  constructor(
    @InjectRepository(SupervisorAccessRequest)
    private readonly requestRepo: Repository<SupervisorAccessRequest>,

    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,

    @InjectRepository(UserComplexAssignment)
    private readonly assignmentRepo: Repository<UserComplexAssignment>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly notificationsService: NotificationsService,
  ) {}

  // ================================================================
  // SUPERVISOR: solicitar acceso a un complejo
  // ================================================================

  async requestAccess(
    input: RequestComplexAccessInput,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const { complexId, lat, lng, message } = input;
    const supervisorId = currentUser.sub;

    // 1. Verificar que el complejo existe
    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
      select: ['id', 'name', 'ownerId', 'latitude', 'longitude', 'gpsRadius'],
    });
    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${complexId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    // 2. Si ya tiene asignación ACTIVA → no necesita solicitar
    const existingAssignment = await this.assignmentRepo.findOne({
      where: {
        userId:    supervisorId,
        complexId,
        role:      ValidRoles.SUPERVISOR_ROL,
        status:    AssignmentStatus.ACTIVE,
      },
    });
    if (existingAssignment) {
      throw new CustomError({
        message: 'Ya tienes acceso activo a este complejo',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AccessRequestErrorCode.ALREADY_ASSIGNED,
      });
    }

    // 3. Si ya existe una solicitud PENDING → no crear duplicado
    const pendingRequest = await this.requestRepo.findOne({
      where: { supervisorId, complexId, status: AccessRequestStatus.PENDING },
    });
    if (pendingRequest) {
      throw new CustomError({
        message: 'Ya tienes una solicitud pendiente para este complejo. Espera a que el administrador la revise',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AccessRequestErrorCode.REQUEST_ALREADY_PENDING,
      });
    }

    // 4. Validación GPS — reutiliza assertGpsWithinComplex del utilitario compartido
    assertGpsWithinComplex(complex, lat, lng);

    // 5. Crear la solicitud
    const request = this.requestRepo.create({
      supervisorId,
      complexId,
      message,
      requestLat: lat,
      requestLng: lng,
      status: AccessRequestStatus.PENDING,
    });

    const saved = await this.requestRepo.save(request);
    this.logger.log(
      `Solicitud de acceso creada: requestId=${saved.id} | supervisor=${supervisorId} | complejo=${complexId}`,
    );

    // 6. Cargar nombre del supervisor para la notificación
    const supervisor = await this.userRepo.findOne({
      where: { id: supervisorId },
      select: ['id', 'name', 'lastName'],
    });
    const supervisorName = supervisor
      ? `${supervisor.name} ${supervisor.lastName}`.trim()
      : currentUser.email;

    // 7. Notificar al admin del complejo
    void this.notificationsService.notify({
      complexId,
      userIds:    [complex.ownerId],
      type:       NotificationType.SYSTEM_ANNOUNCEMENT,
      priority:   NotificationPriority.HIGH,
      title:      'Nueva solicitud de acceso',
      body:       `${supervisorName} solicita acceso al complejo`,
      entityId:   saved.id,
      entityType: 'SupervisorAccessRequest',
      metadata:   {
        requestId:      saved.id,
        supervisorId,
        supervisorName,
        requestLat:     lat,
        requestLng:     lng,
      },
    });

    return this.loadRequestRelations(saved.id);
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: aprobar solicitud
  // ================================================================

  async approveRequest(
    requestId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const request = await this.findPendingRequestWithAccess(requestId, currentUser);

    const existingAssignment = await this.assignmentRepo.findOne({
      where: {
        userId:    request.supervisorId,
        complexId: request.complexId,
        role:      ValidRoles.SUPERVISOR_ROL,
        status:    AssignmentStatus.ACTIVE,
      },
    });

    if (!existingAssignment) {
      await this.assignmentRepo.save(
        this.assignmentRepo.create({
          userId:    request.supervisorId,
          complexId: request.complexId,
          role:      ValidRoles.SUPERVISOR_ROL,
          status:    AssignmentStatus.ACTIVE,
        }),
      );
    }

    await this.requestRepo.update(requestId, {
      status:       AccessRequestStatus.APPROVED,
      resolvedById: currentUser.sub,
      resolvedAt:   new Date(),
    });

    this.logger.log(
      `Solicitud aprobada: requestId=${requestId} | por=${currentUser.sub} | supervisor=${request.supervisorId} | complejo=${request.complexId}`,
    );

    // Cargar nombre del complejo para la notificación
    const complex = await this.complexRepo.findOne({
      where: { id: request.complexId },
      select: ['id', 'name'],
    });
    const complexName = complex?.name ?? 'el complejo';

    void this.notificationsService.notify({
      complexId:  request.complexId,
      userIds:    [request.supervisorId],
      type:       NotificationType.SYSTEM_ANNOUNCEMENT,
      priority:   NotificationPriority.HIGH,
      title:      'Acceso aprobado',
      body:       `Tu solicitud de acceso a ${complexName} fue aprobada. Ya puedes hacer check-in`,
      entityId:   requestId,
      entityType: 'SupervisorAccessRequest',
      metadata:   { requestId, complexId: request.complexId, status: 'APPROVED' },
    });

    return this.loadRequestRelations(requestId);
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: rechazar solicitud
  // ================================================================

  async rejectRequest(
    input: RejectAccessRequestInput,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const { requestId, reason } = input;
    const request = await this.findPendingRequestWithAccess(requestId, currentUser);

    await this.requestRepo.update(requestId, {
      status:          AccessRequestStatus.REJECTED,
      rejectionReason: reason,
      resolvedById:    currentUser.sub,
      resolvedAt:      new Date(),
    });

    this.logger.log(
      `Solicitud rechazada: requestId=${requestId} | por=${currentUser.sub} | complejo=${request.complexId}`,
    );

    const complex = await this.complexRepo.findOne({
      where: { id: request.complexId },
      select: ['id', 'name'],
    });
    const complexName = complex?.name ?? 'el complejo';

    void this.notificationsService.notify({
      complexId:  request.complexId,
      userIds:    [request.supervisorId],
      type:       NotificationType.SYSTEM_ANNOUNCEMENT,
      priority:   NotificationPriority.NORMAL,
      title:      'Solicitud rechazada',
      body:       `Tu solicitud de acceso a ${complexName} fue rechazada. Motivo: ${reason ?? 'Sin motivo'}`,
      entityId:   requestId,
      entityType: 'SupervisorAccessRequest',
      metadata:   { requestId, complexId: request.complexId, status: 'REJECTED', reason },
    });

    return this.loadRequestRelations(requestId);
  }

  // ================================================================
  // SUPERVISOR: ver mis solicitudes
  // ================================================================

  async findMyRequests(supervisorId: string): Promise<SupervisorAccessRequest[]> {
    return this.requestRepo.find({
      where: { supervisorId },
      relations: ['complex'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: ver solicitudes pendientes del complejo
  // ================================================================

  async findPendingForComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest[]> {
    await this.assertComplexAccess(complexId, currentUser);

    return this.requestRepo.find({
      where: { complexId, status: AccessRequestStatus.PENDING },
      relations: ['supervisor'],
      order: { createdAt: 'ASC' },
    });
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: contador de solicitudes pendientes
  // ================================================================

  async countPendingRequests(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<number> {
    await this.assertComplexAccess(complexId, currentUser);
    return this.requestRepo.count({
      where: { complexId, status: AccessRequestStatus.PENDING },
    });
  }

  // ================================================================
  // HELPERS PRIVADOS
  // ================================================================

  private async findPendingRequestWithAccess(
    requestId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new CustomError({
        message: 'Solicitud de acceso no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AccessRequestErrorCode.REQUEST_NOT_FOUND,
      });
    }

    if (request.status !== AccessRequestStatus.PENDING) {
      throw new CustomError({
        message: `Esta solicitud ya fue ${request.status === AccessRequestStatus.APPROVED ? 'aprobada' : 'rechazada'}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AccessRequestErrorCode.REQUEST_ALREADY_RESOLVED,
      });
    }

    await this.assertComplexAccess(request.complexId, currentUser);
    return request;
  }

  private async assertComplexAccess(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    if (currentUser.roles?.includes(ValidRoles.SUPER_ADMIN_ROL)) return;

    if (currentUser.roles?.includes(ValidRoles.COMPLEX_ROL)) {
      const complex = await this.complexRepo.findOne({
        where: { id: complexId },
        select: ['id', 'ownerId'],
      });
      if (complex && (complex.id === currentUser.sub || complex.ownerId === currentUser.sub)) {
        return;
      }
    }

    throw new CustomError({
      message: 'No tienes permiso para gestionar solicitudes de este complejo',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: GeneralErrorCode.FORBIDDEN,
    });
  }

  private async loadRequestRelations(id: string): Promise<SupervisorAccessRequest> {
    return this.requestRepo.findOne({
      where: { id },
      relations: ['supervisor', 'complex', 'resolvedBy'],
    });
  }
}
