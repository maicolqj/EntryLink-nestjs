import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ResidentComplexSwitchService } from './resident-complex-switch.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuditService } from '../../audit/services/audit.service';
import { User } from '../../users/entities/user.entity';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { AuthErrorCode } from '../../shared/constans/error-codes.constants';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';

jest.setTimeout(30_000);

/**
 * Selector de conjunto de RemoteLink: cambia el conjunto de la sesión sin
 * cerrarla y recuerda la elección para el próximo inicio de sesión.
 */
describe('ResidentComplexSwitchService', () => {
  let service: ResidentComplexSwitchService;
  let sessionActive: boolean;

  const device: DeviceInfo = {
    fingerprint: 'fp-1',
    userAgent: 'jest',
    ip: '10.0.0.1',
    platform: 'android',
    deviceId: 'dev-1',
  };
  const currentUser: any = {
    sub: 'user-1',
    complexId: 'complex-1',
    sessionId: 'sess-1',
    roles: [ValidRoles.RESIDENT_ROL],
  };
  const pair = {
    accessToken: 'access-nuevo',
    refreshToken: 'refresh-nuevo',
    expiresIn: 900,
    sessionId: 'sess-1',
  };

  const tokenService = {
    rotateRefreshToken: jest.fn(async () => pair),
    revokeSession: jest.fn(),
  };
  const sessionService = {
    isSessionActive: jest.fn(async () => sessionActive),
    updateSessionActivity: jest.fn(async () => undefined),
  };
  const userRepo = { update: jest.fn(async () => ({ affected: 1 })) };
  const auditService = { log: jest.fn(async () => undefined) };

  beforeEach(async () => {
    sessionActive = true;
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ResidentComplexSwitchService,
        { provide: TokenService, useValue: tokenService },
        { provide: SessionService, useValue: sessionService },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    service = module.get(ResidentComplexSwitchService);
  });

  it('rota con el conjunto nuevo, recuerda la elección, audita y devuelve los tokens', async () => {
    const res = await service.switchComplex(
      currentUser,
      'rt-actual',
      'complex-2',
      device,
    );

    expect(tokenService.rotateRefreshToken).toHaveBeenCalledWith(
      'rt-actual',
      device,
      {
        complexIdOverride: 'complex-2',
        requesterUserId: 'user-1',
      },
    );
    expect(userRepo.update).toHaveBeenCalledWith('user-1', {
      lastResidentComplexId: 'complex-2',
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.COMPLEX_SWITCH,
        entityType: AuditEntityType.User,
        entityId: 'user-1',
        previousValue: { complexId: 'complex-1' },
        newValue: { complexId: 'complex-2' },
        complexId: 'complex-2',
        // RESIDENT_ROL no está entre los roles auditados: sin esto el cambio
        // nunca quedaba registrado.
        alwaysAudit: true,
      }),
    );
    expect(res).toEqual(pair);
  });

  it('con la sesión cerrada: SESSION_TERMINATED y no recuerda nada', async () => {
    sessionActive = false;

    await expect(
      service.switchComplex(currentUser, 'rt-actual', 'complex-2', device),
    ).rejects.toMatchObject({ errorCode: AuthErrorCode.SESSION_TERMINATED });
    expect(tokenService.revokeSession).toHaveBeenCalledWith(
      'sess-1',
      'session_terminated',
    );
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('si la rotación rechaza el cambio, el error sube y no recuerda nada', async () => {
    tokenService.rotateRefreshToken.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        errorCode: AuthErrorCode.RESIDENCE_NOT_AVAILABLE,
      }),
    );

    await expect(
      service.switchComplex(currentUser, 'rt-actual', 'complex-2', device),
    ).rejects.toMatchObject({
      errorCode: AuthErrorCode.RESIDENCE_NOT_AVAILABLE,
    });
    expect(userRepo.update).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });
});
