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
 * Garantías de la clave de acceso: es una por cuenta, nunca basta sola (exige
 * deviceId + fingerprint), no se puede fuerza-brutear cambiando de equipo, y no
 * sobrevive a una cuenta suspendida.
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

  const otherDevice: DeviceInfo = {
    ...device,
    fingerprint: 'fp-tablet-juan',
    deviceId: 'dev-tablet',
  };

  const VALID_CODE = 'K7M2Q4';

  let rows: any[];
  let user: any;
  let queriedDeviceId: string | undefined;

  const deviceRepo = {
    create: jest.fn((data: any) => data),
    save: jest.fn(async (data: any) => {
      const row = { id: `dev-row-${rows.length + 1}`, isRevoked: false, ...data };
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
      where: jest.fn((_sql: string, params: any) => {
        queriedDeviceId = params?.deviceId;
        return deviceRepo.createQueryBuilder();
      }),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () =>
        rows.find(r => !r.isRevoked && r.deviceId === queriedDeviceId) ?? null,
      ),
    })),
  };

  const userRepo = {
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => user),
    })),
    update: jest.fn(async (_id: string, patch: any) => {
      Object.assign(user, patch);
      return { affected: 1 };
    }),
  };

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
    queriedDeviceId = undefined;
    user = {
      id: 'user-1',
      status: UserStatus.ACTIVE,
      accessCodeHash: null,
      accessCodeFailedAttempts: 0,
      accessCodeLockedUntil: null,
      userRoles: [{ role: { name: 'RESIDENT_ROL', permissions: [] } }],
    };
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

  const link = async (code = VALID_CODE, info: DeviceInfo = device) =>
    service.setAccessCode('user-1', code, info);

  // ── Fortaleza de la clave ────────────────────────────────────────────────

  it.each(['AAAAAA', '111111', '123456', '654321', 'ABCDEF', 'ABCDE', 'ABCDEFG'])(
    'rechaza la clave débil %s',
    async (weak) => {
      await expect(link(weak)).rejects.toMatchObject({ errorCode: 'ACCESS_CODE_TOO_WEAK' });
    },
  );

  it('exige combinar letras y números', async () => {
    await expect(link('QWERTY')).rejects.toMatchObject({ errorCode: 'ACCESS_CODE_TOO_WEAK' });
    await expect(link('284917')).rejects.toMatchObject({ errorCode: 'ACCESS_CODE_TOO_WEAK' });
  });

  it('guarda la clave como hash bcrypt en la CUENTA, nunca en el dispositivo', async () => {
    await link();

    expect(user.accessCodeHash).not.toBe(VALID_CODE);
    expect(await bcrypt.compare(VALID_CODE, user.accessCodeHash)).toBe(true);
    expect(rows[0].pinHash).toBeUndefined();
  });

  it('acepta la clave en minúscula: se normaliza a mayúsculas', async () => {
    await link();

    await expect(service.loginWithAccessCode('k7m2q4', device)).resolves.toMatchObject({
      accessToken: 'at',
    });
  });

  // ── Login ────────────────────────────────────────────────────────────────

  it('login con la clave correcta devuelve tokens y usa vigencia extendida', async () => {
    await link();

    const auth = await service.loginWithAccessCode(VALID_CODE, device);

    expect(auth.accessToken).toBe('at');
    expect(tokenService.generateTokenPair).toHaveBeenCalledWith(
      expect.anything(), device, true, 'user', AUTH_CONSTANTS.RESIDENT_DEVICE_REFRESH_EXPIRY,
    );
  });

  it('la misma clave sirve en un segundo equipo ya vinculado', async () => {
    await link();
    await service.linkDevice('user-1', otherDevice);

    await expect(service.loginWithAccessCode(VALID_CODE, otherDevice)).resolves.toMatchObject({
      accessToken: 'at',
    });
  });

  it('la clave correcta desde un equipo NO vinculado no abre sesión', async () => {
    await link();

    await expect(service.loginWithAccessCode(VALID_CODE, otherDevice)).rejects.toMatchObject({
      errorCode: 'DEVICE_NOT_LINKED',
    });
  });

  it('sin header x-device-id no se puede intentar', async () => {
    await link();

    await expect(
      service.loginWithAccessCode(VALID_CODE, { ...device, deviceId: undefined }),
    ).rejects.toMatchObject({ errorCode: 'DEVICE_ID_REQUIRED' });
  });

  it('mismo deviceId pero otro fingerprint no entra', async () => {
    await link();

    await expect(
      service.loginWithAccessCode(VALID_CODE, { ...device, fingerprint: 'fp-otro-navegador' }),
    ).rejects.toMatchObject({ errorCode: 'DEVICE_NOT_LINKED' });
  });

  it('cuenta suspendida: la clave correcta no abre sesión', async () => {
    await link();
    user.status = UserStatus.SUSPENDED;

    await expect(service.loginWithAccessCode(VALID_CODE, device)).rejects.toMatchObject({
      errorCode: 'USER_SUSPENDED',
    });
  });

  // ── Fuerza bruta ─────────────────────────────────────────────────────────

  it('bloquea la cuenta tras agotar los intentos', async () => {
    await link();

    for (let i = 1; i < AUTH_CONSTANTS.MAX_ACCESS_CODE_ATTEMPTS; i++) {
      await expect(service.loginWithAccessCode('Z9Z9Z9', device)).rejects.toMatchObject({
        errorCode: 'ACCESS_CODE_INVALID',
      });
    }

    await expect(service.loginWithAccessCode('Z9Z9Z9', device)).rejects.toMatchObject({
      errorCode: 'ACCESS_CODE_LOCKED',
    });

    // El bloqueo también frena a quien sí conoce la clave, hasta que expire.
    await expect(service.loginWithAccessCode(VALID_CODE, device)).rejects.toMatchObject({
      errorCode: 'ACCESS_CODE_LOCKED',
    });
    // Timeout ampliado: cada intento paga un bcrypt.compare de 12 rondas y en
    // la corrida completa los workers de jest compiten por CPU.
  }, 30_000);

  it('cambiar de equipo no regala intentos: el conteo es de la cuenta', async () => {
    await link();
    await service.linkDevice('user-1', otherDevice);

    for (let i = 1; i < AUTH_CONSTANTS.MAX_ACCESS_CODE_ATTEMPTS; i++) {
      await expect(service.loginWithAccessCode('Z9Z9Z9', device)).rejects.toBeDefined();
    }

    // El siguiente fallo llega desde el otro dispositivo y aun así bloquea.
    await expect(service.loginWithAccessCode('Z9Z9Z9', otherDevice)).rejects.toMatchObject({
      errorCode: 'ACCESS_CODE_LOCKED',
    });
  }, 30_000);

  it('agotar los intentos NO desvincula el dispositivo', async () => {
    await link();

    for (let i = 1; i <= AUTH_CONSTANTS.MAX_ACCESS_CODE_ATTEMPTS; i++) {
      await expect(service.loginWithAccessCode('Z9Z9Z9', device)).rejects.toBeDefined();
    }

    expect(rows[0].isRevoked).toBe(false);
  }, 30_000);

  it('cambiar la clave limpia el bloqueo (el residente ya probó identidad con sesión válida)', async () => {
    await link();
    user.accessCodeFailedAttempts = 4;
    user.accessCodeLockedUntil = new Date(Date.now() + 60_000);

    await service.setAccessCode('user-1', 'R3T8W1', device);

    expect(user.accessCodeFailedAttempts).toBe(0);
    expect(user.accessCodeLockedUntil).toBeNull();
  });

  // ── Verificación como segundo factor ─────────────────────────────────────

  it('verifyAccessCode acepta la clave correcta y rechaza la incorrecta', async () => {
    await link();

    await expect(service.verifyAccessCode('user-1', VALID_CODE)).resolves.toBeUndefined();
    await expect(service.verifyAccessCode('user-1', 'Z9Z9Z9')).rejects.toMatchObject({
      errorCode: 'ACCESS_CODE_INVALID',
    });
  });

  it('verifyAccessCode falla si la cuenta todavía no tiene clave', async () => {
    await expect(service.verifyAccessCode('user-1', VALID_CODE)).rejects.toMatchObject({
      errorCode: 'ACCESS_CODE_NOT_SET',
    });
  });

  it('hasAccessCode refleja si la cuenta ya la creó', async () => {
    await expect(service.hasAccessCode('user-1')).resolves.toBe(false);
    await link();
    await expect(service.hasAccessCode('user-1')).resolves.toBe(true);
  });

  // ── Revocación ───────────────────────────────────────────────────────────

  it('revocar un dispositivo cierra solo su sesión', async () => {
    await link();
    rows[0].sessionId = 'sess-perdida';

    await service.revokeDevice('user-1', 'dev-row-1');

    expect(rows[0].isRevoked).toBe(true);
    expect(tokenService.revokeSession).toHaveBeenCalledWith('sess-perdida', 'device_revoked');
  });

  it('revocar los demás equipos deja vivo solo el actual (celular perdido)', async () => {
    await link();
    await service.linkDevice('user-1', otherDevice);
    rows[0].sessionId = 'sess-vieja';

    const revoked = await service.revokeOtherDevices('user-1', otherDevice);

    expect(revoked).toBe(1);
    expect(rows.find(r => r.deviceId === 'dev-juan').isRevoked).toBe(true);
    expect(rows.find(r => r.deviceId === 'dev-tablet').isRevoked).toBe(false);
    expect(tokenService.revokeSession).toHaveBeenCalledWith('sess-vieja', 'device_revoked');
  });
});
