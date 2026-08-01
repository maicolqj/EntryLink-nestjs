import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';

import { ResidentDeviceService } from './resident-device.service';
import { ResidentDevice } from '../entities/resident-device.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { AUTH_CONSTANTS } from '../constants/auth.constants';

/**
 * Garantías del login por PIN: el PIN nunca basta solo (exige deviceId +
 * fingerprint), no se puede fuerza-brutear, y no sobrevive a una cuenta
 * suspendida.
 */
describe('ResidentDeviceService', () => {
  let service: ResidentDeviceService;

  const device: DeviceInfo = {
    fingerprint: 'fp-telefono-juan',
    userAgent: 'jest',
    ip: '10.0.0.1',
    platform: 'android',
    deviceId: 'dev-juan',
  };

  const VALID_PIN = '482913';

  let rows: any[];
  let userStatus: UserStatus;

  const deviceRepo = {
    create: jest.fn((data: any) => data),
    save: jest.fn(async (data: any) => {
      const row = { id: 'dev-row-1', failedAttempts: 0, isRevoked: false, ...data };
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
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => rows.find(r => !r.isRevoked) ?? null),
    })),
  };

  const userQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => ({
      id: 'user-1',
      status: userStatus,
      userRoles: [{ role: { name: 'RESIDENT_ROL', permissions: [] } }],
    })),
  };

  const userRepo = { createQueryBuilder: jest.fn(() => userQueryBuilder) };

  const tokenService = {
    generateTokenPair: jest.fn(async () => ({
      accessToken: 'at', refreshToken: 'rt', expiresIn: 900, sessionId: 'sess-1',
    })),
    revokeSession: jest.fn(async () => undefined),
  };

  const sessionService = {
    enforceSessionLimit: jest.fn(async () => undefined),
    createOrUpdateSession: jest.fn(async () => undefined),
    terminateSession: jest.fn(async () => true),
  };

  beforeEach(async () => {
    rows = [];
    userStatus = UserStatus.ACTIVE;
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ResidentDeviceService,
        { provide: getRepositoryToken(ResidentDevice), useValue: deviceRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: TokenService, useValue: tokenService },
        { provide: SessionService, useValue: sessionService },
      ],
    }).compile();

    service = module.get(ResidentDeviceService);
  });

  const link = async (pin = VALID_PIN) => service.setDevicePin('user-1', pin, device);

  // ── Fortaleza del PIN ───────────────────────────────────────────────────

  it.each(['000000', '111111', '123456', '654321', '121212', '123123'])(
    'rechaza el PIN obvio %s',
    async (weak) => {
      await expect(link(weak)).rejects.toMatchObject({ errorCode: 'DEVICE_PIN_TOO_WEAK' });
    },
  );

  it('guarda el PIN como hash bcrypt, nunca en claro', async () => {
    await link();

    expect(rows[0].pinHash).not.toBe(VALID_PIN);
    expect(await bcrypt.compare(VALID_PIN, rows[0].pinHash)).toBe(true);
  });

  // ── Login ────────────────────────────────────────────────────────────────

  it('login con el PIN correcto devuelve tokens y usa vigencia extendida', async () => {
    await link();

    const auth = await service.loginWithDevicePin(VALID_PIN, device);

    expect(auth.accessToken).toBe('at');
    expect(tokenService.generateTokenPair).toHaveBeenCalledWith(
      expect.anything(), device, true, 'user', AUTH_CONSTANTS.RESIDENT_DEVICE_REFRESH_EXPIRY,
    );
  });

  it('sin header x-device-id no se puede intentar', async () => {
    await link();

    await expect(
      service.loginWithDevicePin(VALID_PIN, { ...device, deviceId: undefined }),
    ).rejects.toMatchObject({ errorCode: 'DEVICE_ID_REQUIRED' });
  });

  it('mismo deviceId pero otro fingerprint no entra', async () => {
    await link();

    await expect(
      service.loginWithDevicePin(VALID_PIN, { ...device, fingerprint: 'fp-otro-navegador' }),
    ).rejects.toMatchObject({ errorCode: 'DEVICE_NOT_LINKED' });
  });

  it('cuenta suspendida: el PIN correcto no abre sesión', async () => {
    await link();
    userStatus = UserStatus.SUSPENDED;

    await expect(service.loginWithDevicePin(VALID_PIN, device)).rejects.toMatchObject({
      errorCode: 'USER_SUSPENDED',
    });
  });

  // ── Fuerza bruta ─────────────────────────────────────────────────────────

  it('bloquea temporalmente tras agotar los intentos', async () => {
    await link();

    for (let i = 1; i < AUTH_CONSTANTS.MAX_DEVICE_PIN_ATTEMPTS; i++) {
      await expect(service.loginWithDevicePin('999999', device)).rejects.toMatchObject({
        errorCode: 'DEVICE_PIN_INVALID',
      });
    }

    await expect(service.loginWithDevicePin('999999', device)).rejects.toMatchObject({
      errorCode: 'DEVICE_LOCKED',
    });

    // El bloqueo también frena al que sí conoce el PIN, hasta que expire.
    await expect(service.loginWithDevicePin(VALID_PIN, device)).rejects.toMatchObject({
      errorCode: 'DEVICE_LOCKED',
    });
    // Timeout ampliado: cada intento paga un bcrypt.compare de 12 rondas y en
    // la corrida completa los workers de jest compiten por CPU.
  }, 30_000);

  it('revoca el dispositivo tras la segunda tanda de intentos', async () => {
    await link();

    const total = AUTH_CONSTANTS.MAX_DEVICE_PIN_ATTEMPTS * AUTH_CONSTANTS.MAX_DEVICE_PIN_LOCKOUTS;

    for (let i = 1; i <= total; i++) {
      // Se ignora el bloqueo temporal para simular al atacante que espera.
      rows[0].lockedUntil = null;
      await expect(service.loginWithDevicePin('999999', device)).rejects.toBeDefined();
    }

    expect(rows[0].isRevoked).toBe(true);
    expect(rows[0].revokedReason).toBe('pin_bruteforce');
  }, 30_000);

  it('re-vincular limpia el bloqueo (el residente ya probó identidad con sesión válida)', async () => {
    await link();
    rows[0].failedAttempts = 4;
    rows[0].lockedUntil = new Date(Date.now() + 60_000);

    await service.setDevicePin('user-1', '571824', device);

    expect(rows[0].failedAttempts).toBe(0);
    expect(rows[0].lockedUntil).toBeNull();
  });

  // ── Revocación ───────────────────────────────────────────────────────────

  it('revocar un dispositivo cierra solo su sesión', async () => {
    await link();
    rows[0].sessionId = 'sess-perdida';

    await service.revokeDevice('user-1', 'dev-row-1');

    expect(rows[0].isRevoked).toBe(true);
    expect(tokenService.revokeSession).toHaveBeenCalledWith('sess-perdida', 'device_revoked');
  });
});
