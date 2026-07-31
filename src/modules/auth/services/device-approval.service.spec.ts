import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DeviceApprovalService } from './device-approval.service';
import { DeviceApprovalRequest } from '../entities/device-approval-request.entity';
import { DeviceApprovalStatus } from '../enums/device-approval-status.enum';
import { ResidentDevice } from '../entities/resident-device.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';

/**
 * Garantías del ingreso aprobado por push:
 *   - quien aprueba nunca recibe el secreto que canjea la sesión;
 *   - solo el dueño de la cuenta puede aprobar, y solo una vez;
 *   - un rechazo es terminal;
 *   - si el push falla, la solicitud sigue viva y resoluble desde la app.
 */
describe('DeviceApprovalService', () => {
  let service: DeviceApprovalService;

  const requester: DeviceInfo = {
    fingerprint: 'fp-equipo-nuevo',
    userAgent: 'Mozilla/5.0 Chrome/120',
    ip: '190.1.2.3',
    platform: 'web',
    deviceId: 'dev-nuevo',
  };

  let rows: any[];
  let userStatus: UserStatus;

  const approvalRepo = {
    create: jest.fn((data: any) => data),
    save: jest.fn(async (data: any) => {
      const row = { id: `chall-${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    find: jest.fn(async ({ where }: any) =>
      rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)),
    ),
    findOne: jest.fn(async ({ where }: any) =>
      rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
    ),
    update: jest.fn(async (criteria: any, patch: any) => {
      const match = typeof criteria === 'string' ? { id: criteria } : criteria;
      const found = rows.filter(r => Object.entries(match).every(([k, v]) => r[k] === v));
      found.forEach(r => Object.assign(r, patch));
      return { affected: found.length };
    }),
    delete: jest.fn(async () => ({ affected: 0 })),
  };

  const deviceRepo = { count: jest.fn(async () => 1) };

  const userQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => ({
      id: 'user-1',
      complexId: 'complex-1',
      status: userStatus,
      userRoles: [{ role: { name: 'RESIDENT_ROL', permissions: [] } }],
    })),
  };

  const userRepo = { createQueryBuilder: jest.fn(() => userQueryBuilder) };

  const tokenService = {
    generateTokenPair: jest.fn(async () => ({
      accessToken: 'at', refreshToken: 'rt', expiresIn: 900, sessionId: 'sess-nueva',
    })),
  };

  const sessionService = {
    enforceSessionLimit: jest.fn(async () => undefined),
    createOrUpdateSession: jest.fn(async () => undefined),
  };

  const cacheService = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };

  const notificationsService = {
    dispatchPushOnly: jest.fn(async (_userIds: string[], _params: any) => undefined),
  };

  beforeEach(async () => {
    rows = [];
    userStatus = UserStatus.ACTIVE;
    jest.clearAllMocks();
    deviceRepo.count.mockResolvedValue(1);

    const module = await Test.createTestingModule({
      providers: [
        DeviceApprovalService,
        { provide: getRepositoryToken(DeviceApprovalRequest), useValue: approvalRepo },
        { provide: getRepositoryToken(ResidentDevice), useValue: deviceRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: TokenService, useValue: tokenService },
        { provide: SessionService, useValue: sessionService },
        { provide: CacheService, useValue: cacheService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(DeviceApprovalService);
  });

  const request = () => service.requestApproval('1020304050', requester);

  // ── Emisión ──────────────────────────────────────────────────────────────

  it('emite un código corto y notifica por push a los dispositivos del residente', async () => {
    const res = await request();

    expect(res.approvalCode).toMatch(/^[A-Z2-9]{4}$/);
    expect(notificationsService.dispatchPushOnly).toHaveBeenCalledWith(
      ['user-1'],
      expect.objectContaining({ type: NotificationType.LOGIN_APPROVAL_REQUEST }),
    );
  });

  it('el push lleva el approvalId, nunca el challengeId', async () => {
    const res = await request();

    const params = notificationsService.dispatchPushOnly.mock.calls[0][1] as any;

    expect(params.metadata.approvalId).toBe(rows[0].approvalId);
    expect(JSON.stringify(params)).not.toContain(res.challengeId);
  });

  it('describe el equipo solicitante para que el residente pueda juzgarlo', async () => {
    await request();

    expect(rows[0].requestedFromLabel).toBe('Chrome en un navegador web');
    expect(rows[0].requestedFromIp).toBe('190.1.2.3');
  });

  it('una solicitud nueva invalida la anterior de la misma identidad', async () => {
    await request();
    await request();

    expect(rows[0].status).toBe(DeviceApprovalStatus.EXPIRED);
    expect(rows[1].status).toBe(DeviceApprovalStatus.PENDING);
  });

  it('si el push falla la solicitud sigue viva', async () => {
    notificationsService.dispatchPushOnly.mockRejectedValueOnce(new Error('FCM caído') as never);

    const res = await request();

    expect(res.challengeId).toBeDefined();
    expect(rows[0].status).toBe(DeviceApprovalStatus.PENDING);
  });

  it('identidad no registrada: emite solicitud pero no notifica a nadie', async () => {
    userQueryBuilder.getOne.mockResolvedValueOnce(null);

    const res = await service.requestApproval('0000000000', requester);

    expect(res.approvalCode).toBeDefined(); // respuesta indistinguible (anti-enumeration)
    expect(notificationsService.dispatchPushOnly).not.toHaveBeenCalled();
  });

  // ── Aprobación ───────────────────────────────────────────────────────────

  it('quien aprueba ve el código pero no el challengeId', async () => {
    const res = await request();

    const pending = await service.listPending('user-1');

    expect(pending[0].approvalCode).toBe(res.approvalCode);
    expect(pending[0].approvalId).toBe(rows[0].approvalId);
    expect(JSON.stringify(pending[0])).not.toContain(res.challengeId);
  });

  it('otro usuario no puede aprobar la solicitud', async () => {
    await request();

    await expect(
      service.approve(rows[0].approvalId, 'otro-user', 'sess-x'),
    ).rejects.toMatchObject({ errorCode: 'APPROVAL_NOT_FOUND' });
  });

  it('no se puede aprobar dos veces', async () => {
    await request();
    await service.approve(rows[0].approvalId, 'user-1', 'sess-confiable');

    await expect(
      service.approve(rows[0].approvalId, 'user-1', 'sess-confiable'),
    ).rejects.toMatchObject({ errorCode: 'APPROVAL_ALREADY_RESOLVED' });
  });

  it('una solicitud vencida no se puede aprobar', async () => {
    await request();
    rows[0].expiresAt = new Date(Date.now() - 1_000);

    await expect(
      service.approve(rows[0].approvalId, 'user-1', 'sess-confiable'),
    ).rejects.toMatchObject({ errorCode: 'APPROVAL_EXPIRED' });
  });

  // ── Canje ────────────────────────────────────────────────────────────────

  it('canje exitoso tras aprobar, y un solo uso', async () => {
    const res = await request();
    await service.approve(rows[0].approvalId, 'user-1', 'sess-confiable');

    const auth = await service.redeem(res.challengeId, requester);
    expect(auth.accessToken).toBe('at');

    await expect(service.redeem(res.challengeId, requester)).rejects.toMatchObject({
      errorCode: 'APPROVAL_CONSUMED',
    });
  });

  it('canjear sin aprobar falla', async () => {
    const res = await request();

    await expect(service.redeem(res.challengeId, requester)).rejects.toMatchObject({
      errorCode: 'APPROVAL_PENDING',
    });
  });

  it('un rechazo es terminal: el solicitante no obtiene sesión', async () => {
    const res = await request();
    await service.deny(rows[0].approvalId, 'user-1', 'sess-confiable');

    await expect(service.redeem(res.challengeId, requester)).rejects.toMatchObject({
      errorCode: 'APPROVAL_DENIED',
    });
  });

  it('otro dispositivo no puede canjear aunque la solicitud esté aprobada', async () => {
    const res = await request();
    await service.approve(rows[0].approvalId, 'user-1', 'sess-confiable');

    const attacker: DeviceInfo = { ...requester, fingerprint: 'fp-atacante' };

    await expect(service.redeem(res.challengeId, attacker)).rejects.toMatchObject({
      errorCode: 'APPROVAL_NOT_FOUND',
    });
  });

  it('cuenta suspendida: aprobar no alcanza para entrar', async () => {
    const res = await request();
    await service.approve(rows[0].approvalId, 'user-1', 'sess-confiable');
    userStatus = UserStatus.SUSPENDED;

    await expect(service.redeem(res.challengeId, requester)).rejects.toMatchObject({
      errorCode: 'USER_SUSPENDED',
    });
  });

  it('rate limit por identidad', async () => {
    cacheService.get.mockResolvedValue({ count: 3 } as any);

    await expect(request()).rejects.toMatchObject({ errorCode: 'APPROVAL_RATE_LIMIT' });
  });
});
