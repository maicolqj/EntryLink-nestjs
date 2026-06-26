import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { SupervisorAccessRequestService } from './supervisor-access-request.service';
import { SupervisorAccessRequest } from '../entities/supervisor-access-request.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { UserComplexAssignment, AssignmentStatus } from '../../users/entities/user-complex-assignment.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AccessRequestStatus } from '../enums/access-request-status.enum';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
});

describe('SupervisorAccessRequestService.requestAccess', () => {
  let service: SupervisorAccessRequestService;
  let requestRepo: ReturnType<typeof mockRepo>;
  let complexRepo: ReturnType<typeof mockRepo>;
  let assignmentRepo: ReturnType<typeof mockRepo>;
  let userRepo: ReturnType<typeof mockRepo>;
  let notificationsService: { notify: jest.Mock };

  const supervisor = { sub: 'sup-1', email: 'sup@test.com', roles: [ValidRoles.SUPERVISOR_ROL] } as any;

  beforeEach(async () => {
    requestRepo = mockRepo();
    complexRepo = mockRepo();
    assignmentRepo = mockRepo();
    userRepo = mockRepo();
    notificationsService = { notify: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        SupervisorAccessRequestService,
        { provide: getRepositoryToken(SupervisorAccessRequest), useValue: requestRepo },
        { provide: getRepositoryToken(ResidentialComplex),       useValue: complexRepo },
        { provide: getRepositoryToken(UserComplexAssignment),    useValue: assignmentRepo },
        { provide: getRepositoryToken(User),                     useValue: userRepo },
        { provide: NotificationsService,                         useValue: notificationsService },
      ],
    }).compile();

    service = module.get(SupervisorAccessRequestService);
  });

  it('lanza ALREADY_ASSIGNED cuando el supervisor ya tiene asignación activa', async () => {
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: null, longitude: null, gpsRadius: null });
    assignmentRepo.findOne.mockResolvedValue({ id: 'a1', status: AssignmentStatus.ACTIVE });
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    await expect(service.requestAccess({ complexId: 'c1', lat: 4.7, lng: -74.0 }, supervisor))
      .rejects.toBeInstanceOf(CustomError);
  });

  it('lanza REQUEST_ALREADY_PENDING cuando ya hay solicitud pendiente', async () => {
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: null, longitude: null, gpsRadius: null });
    assignmentRepo.findOne.mockResolvedValue(null);
    requestRepo.findOne.mockResolvedValue({ id: 'r1', status: AccessRequestStatus.PENDING });
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    await expect(service.requestAccess({ complexId: 'c1', lat: 4.7, lng: -74.0 }, supervisor))
      .rejects.toBeInstanceOf(CustomError);
  });

  it('lanza SUPERVISOR_OUT_OF_RANGE cuando el GPS está fuera del radio', async () => {
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: 4.711, longitude: -74.072, gpsRadius: 200 });
    assignmentRepo.findOne.mockResolvedValue(null);
    requestRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    // 4.721 está ~1.1 km al norte → fuera de 200 m
    await expect(service.requestAccess({ complexId: 'c1', lat: 4.721, lng: -74.072 }, supervisor))
      .rejects.toBeInstanceOf(CustomError);
  });

  it('crea la solicitud y notifica al admin cuando todo es válido', async () => {
    const savedRequest = { id: 'req-1', supervisorId: 'sup-1', complexId: 'c1', status: AccessRequestStatus.PENDING };
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: null, longitude: null, gpsRadius: null });
    assignmentRepo.findOne.mockResolvedValue(null);
    requestRepo.findOne
      .mockResolvedValueOnce(null)   // no pending
      .mockResolvedValueOnce({ ...savedRequest, supervisor: {}, complex: {}, resolvedBy: null }); // loadRelations
    requestRepo.create.mockReturnValue(savedRequest);
    requestRepo.save.mockResolvedValue(savedRequest);
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    await service.requestAccess({ complexId: 'c1', lat: 4.711, lng: -74.072 }, supervisor);

    // El destinatario es el complexId: COMPLEX_ROL tiene sub = complex.id en el
    // JWT, por eso el servicio notifica a [complexId] y no al ownerId.
    expect(notificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['c1'], title: 'Nueva solicitud de acceso' }),
    );
  });
});
