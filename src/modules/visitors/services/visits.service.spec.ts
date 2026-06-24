import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { VisitsService } from './visits.service';
import { VisitAccessTokenService } from './visit-access-token.service';
import { VisitorsService } from './visitors.service';
import { Visit } from '../entities/visit.entity';
import { VisitType } from '../enums/visit-type.enum';
import { VisitStatus } from '../enums/visit-status.enum';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AuditService } from '../../audit/services/audit.service';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { CustomError } from '../../shared/utils/errors.utils';

/**
 * Gate de seguridad de registerVisitorEntry (Option A):
 * una visita SCHEDULED solo puede pasar a INSIDE con un accessToken de un solo
 * uso emitido por validateQrAccess. Walk-in conserva su flujo sin token.
 */
describe('VisitsService.registerEntry — gate de QR para visitas SCHEDULED', () => {
  let service: VisitsService;
  let visitRepo: { findOne: jest.Mock; save: jest.Mock };
  let accessTokens: { verify: jest.Mock; consume: jest.Mock; issue: jest.Mock };

  const currentUser = {
    sub: 'guard-1',
    email: 'guard@test.com',
    roles: ['SECURITY_ROL'],
    entityType: 'user',
  } as any;

  /** Construye una visita base con relaciones mínimas para notifyUnit. */
  const makeVisit = (over: Partial<Visit>): Visit => ({
    id: 'visit-1',
    type: VisitType.SCHEDULED,
    status: VisitStatus.APPROVED,
    complexId: 'cpx-1',
    unitId: 'unit-1',
    visitorId: 'vtr-1',
    qrUsed: false,
    visitor: { fullName: 'JUAN PEREZ' } as any,
    ...over,
  }) as Visit;

  beforeEach(async () => {
    visitRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation(async (v) => v),
    };
    accessTokens = {
      verify: jest.fn(),
      consume: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        VisitsService,
        { provide: getRepositoryToken(Visit), useValue: visitRepo },
        { provide: VisitAccessTokenService, useValue: accessTokens },
        { provide: VisitorsService, useValue: {} },
        { provide: ResidentialComplexService, useValue: {} },
        { provide: UnitService, useValue: {} },
        // notifyUnit consulta residentes activos; lista vacía → no notifica
        { provide: ResidentsService, useValue: { findActiveByUnitInternal: jest.fn().mockResolvedValue([]) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: SocketService, useValue: { emitToComplex: jest.fn() } },
      ],
    }).compile();

    service = module.get(VisitsService);
  });

  it('(a) SCHEDULED sin token → rechaza y no transiciona', async () => {
    visitRepo.findOne.mockResolvedValue(makeVisit({}));

    await expect(service.registerEntry('visit-1', currentUser))
      .rejects.toBeInstanceOf(CustomError);

    expect(accessTokens.verify).not.toHaveBeenCalled();
    expect(visitRepo.save).not.toHaveBeenCalled();
  });

  it('(b) token de otra visita → rechaza', async () => {
    visitRepo.findOne.mockResolvedValue(makeVisit({}));
    accessTokens.verify.mockResolvedValue({ visitId: 'otra-visita', visitorId: 'vtr-1', jti: 'jti-1' });

    await expect(service.registerEntry('visit-1', currentUser, 'tok'))
      .rejects.toBeInstanceOf(CustomError);

    expect(accessTokens.consume).not.toHaveBeenCalled();
    expect(visitRepo.save).not.toHaveBeenCalled();
  });

  it('(c) token reusado/inválido (verify → null) → rechaza', async () => {
    visitRepo.findOne.mockResolvedValue(makeVisit({}));
    accessTokens.verify.mockResolvedValue(null);

    await expect(service.registerEntry('visit-1', currentUser, 'tok-consumido'))
      .rejects.toBeInstanceOf(CustomError);

    expect(accessTokens.consume).not.toHaveBeenCalled();
    expect(visitRepo.save).not.toHaveBeenCalled();
  });

  it('(d) token válido → consume, marca qrUsed y transiciona a INSIDE', async () => {
    const visit = makeVisit({});
    visitRepo.findOne.mockResolvedValue(visit);
    accessTokens.verify.mockResolvedValue({ visitId: 'visit-1', visitorId: 'vtr-1', jti: 'jti-1' });

    const result = await service.registerEntry('visit-1', currentUser, 'tok-valido');

    expect(accessTokens.consume).toHaveBeenCalledWith('jti-1');
    expect(result.status).toBe(VisitStatus.INSIDE);
    expect(result.qrUsed).toBe(true);
    expect(result.entryTime).toBeInstanceOf(Date);
    expect(visitRepo.save).toHaveBeenCalled();
  });

  it('(e) WALK_IN sin token → ingresa normal (no exige token)', async () => {
    const visit = makeVisit({ type: VisitType.WALK_IN });
    visitRepo.findOne.mockResolvedValue(visit);

    const result = await service.registerEntry('visit-1', currentUser);

    expect(accessTokens.verify).not.toHaveBeenCalled();
    expect(accessTokens.consume).not.toHaveBeenCalled();
    expect(result.status).toBe(VisitStatus.INSIDE);
    expect(visitRepo.save).toHaveBeenCalled();
  });
});
