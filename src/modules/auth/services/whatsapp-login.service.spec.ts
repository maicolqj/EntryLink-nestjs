import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';

import { WhatsAppLoginService } from './whatsapp-login.service';
import { WhatsAppLoginChallenge } from '../entities/whatsapp-login-challenge.entity';
import { WhatsAppLoginStatus } from '../enums/whatsapp-login-status.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { ResidentDeviceService } from './resident-device.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';

/**
 * Garantías de seguridad del login "reverse-OTP":
 *   - el nonce solo confirma si lo envía el teléfono del dueño del documento;
 *   - conocer el nonce (que viaja por WhatsApp) no permite canjear la sesión;
 *   - el canje es de un solo uso y solo desde el dispositivo que lo inició.
 */
describe('WhatsAppLoginService', () => {
  let service: WhatsAppLoginService;

  const device: DeviceInfo = {
    fingerprint: 'fp-solicitante',
    userAgent: 'jest',
    ip: '10.0.0.1',
    platform: 'web',
    deviceId: 'dev-1',
  };

  const resident: Partial<User> = {
    id: 'user-1',
    phoneNumber: '3001234567',
    status: UserStatus.ACTIVE,
  };

  let challenges: WhatsAppLoginChallenge[];

  const challengeRepo = {
    create: jest.fn((data: any) => data),
    save: jest.fn(async (data: any) => {
      const row = { id: 'chall-1', createdAt: new Date(), ...data };
      challenges.push(row);
      return row;
    }),
    findOne: jest.fn(async ({ where }: any) => {
      return (
        challenges.find(c =>
          Object.entries(where).every(([k, v]) => (c as any)[k] === v),
        ) ?? null
      );
    }),
    update: jest.fn(async (criteria: any, patch: any) => {
      const match = typeof criteria === 'string' ? { id: criteria } : criteria;
      const rows = challenges.filter(c =>
        Object.entries(match).every(([k, v]) => (c as any)[k] === v),
      );
      rows.forEach(r => Object.assign(r, patch));
      return { affected: rows.length };
    }),
    delete: jest.fn(async () => ({ affected: 0 })),
  };

  // findResidentByIdentity y loadResidentWithRoles usan QueryBuilder.
  const userQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => ({
      ...resident,
      userRoles: [{ role: { name: 'RESIDENT_ROL', permissions: [] } }],
    })),
  };

  const userRepo = {
    createQueryBuilder: jest.fn(() => userQueryBuilder),
    findOne: jest.fn(async () => resident),
  };

  const tokenService = {
    generateTokenPair: jest.fn(async () => ({
      accessToken: 'at', refreshToken: 'rt', expiresIn: 900, sessionId: 'sess-1',
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

  // La cuenta de las pruebas todavía no tiene clave de acceso: ese es el primer
  // ingreso, el único que puede vincular un equipo sin segundo factor.
  const residentDeviceService = {
    hasAccessCode: jest.fn(async () => false),
    isDeviceLinked: jest.fn(async () => false),
    verifyAccessCode: jest.fn(async () => undefined),
    linkDevice: jest.fn(async () => ({ id: 'dev-row-1' })),
    grantResetPermission: jest.fn(async () => undefined),
  };

  beforeEach(async () => {
    challenges = [];
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        WhatsAppLoginService,
        { provide: getRepositoryToken(WhatsAppLoginChallenge), useValue: challengeRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: TokenService, useValue: tokenService },
        { provide: SessionService, useValue: sessionService },
        { provide: ResidentDeviceService, useValue: residentDeviceService },
        { provide: CacheService, useValue: cacheService },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              k === 'WHATSAPP_BUSINESS_NUMBER' ? '573009998877' : undefined,
          },
        },
      ],
    }).compile();

    service = module.get(WhatsAppLoginService);
  });

  const request = () => service.requestChallenge('1020304050', device);

  it('emite un link wa.me con el nonce prellenado', async () => {
    const res = await request();

    expect(res.nonce).toMatch(/^[A-Z2-9]{8}$/);
    expect(res.whatsappUrl).toContain('https://wa.me/573009998877');
    expect(res.whatsappUrl).toContain(encodeURIComponent(`INGRESAR ${res.nonce}`));
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('confirma cuando el mensaje llega del teléfono del dueño del documento', async () => {
    const res = await request();

    // Meta manda el `from` con indicativo; en BD está sin él.
    await service.confirmFromInboundMessage('573001234567', `INGRESAR ${res.nonce}`);

    const status = await service.getStatus(res.challengeId, device);
    expect(status.status).toBe(WhatsAppLoginStatus.CONFIRMED);
  });

  it('NO confirma si el nonce llega desde otro teléfono', async () => {
    const res = await request();

    await service.confirmFromInboundMessage('573009999999', `INGRESAR ${res.nonce}`);

    const status = await service.getStatus(res.challengeId, device);
    expect(status.status).toBe(WhatsAppLoginStatus.PENDING);
  });

  it('acepta el texto en minúscula y con espacios de más', async () => {
    const res = await request();

    await service.confirmFromInboundMessage('573001234567', `  ingresar   ${res.nonce.toLowerCase()}  `);

    const status = await service.getStatus(res.challengeId, device);
    expect(status.status).toBe(WhatsAppLoginStatus.CONFIRMED);
  });

  it('canjear sin confirmar falla', async () => {
    const res = await request();

    await expect(service.redeem(res.challengeId, device)).rejects.toMatchObject({
      errorCode: 'WA_LOGIN_CHALLENGE_PENDING',
    });
  });

  it('canje exitoso devuelve tokens y deja el challenge consumido', async () => {
    const res = await request();
    await service.confirmFromInboundMessage('573001234567', `INGRESAR ${res.nonce}`);

    const auth = await service.redeem(res.challengeId, device);
    expect(auth.accessToken).toBe('at');

    // Un segundo canje del mismo challenge no puede abrir otra sesión.
    await expect(service.redeem(res.challengeId, device)).rejects.toMatchObject({
      errorCode: 'WA_LOGIN_CHALLENGE_CONSUMED',
    });
  });

  it('pedir la clave no consume el challenge: el reintento con la clave entra', async () => {
    // Regresión: el canje marcaba CONSUMED antes de exigir la clave, así que el
    // primer intento —el que no la trae— quemaba el challenge y el residente
    // quedaba encerrado con "este intento ya fue usado".
    residentDeviceService.hasAccessCode.mockResolvedValue(true);

    const res = await request();
    await service.confirmFromInboundMessage('573001234567', `INGRESAR ${res.nonce}`);

    await expect(service.redeem(res.challengeId, device)).rejects.toMatchObject({
      errorCode: 'ACCESS_CODE_REQUIRED',
    });

    const auth = await service.redeem(res.challengeId, device, 'K7M2Q4');
    expect(auth.accessToken).toBe('at');
    expect(residentDeviceService.verifyAccessCode).toHaveBeenCalledWith('user-1', 'K7M2Q4');

    // clearAllMocks no borra las implementaciones: sin esto, el `true` se
    // filtraría a las pruebas siguientes según el orden de ejecución.
    residentDeviceService.hasAccessCode.mockResolvedValue(false);
  });

  it('otro dispositivo no puede canjear aunque el challenge esté confirmado', async () => {
    const res = await request();
    await service.confirmFromInboundMessage('573001234567', `INGRESAR ${res.nonce}`);

    const attacker: DeviceInfo = { ...device, fingerprint: 'fp-atacante' };

    await expect(service.redeem(res.challengeId, attacker)).rejects.toMatchObject({
      errorCode: 'WA_LOGIN_CHALLENGE_NOT_FOUND',
    });
  });

  it('un challenge vencido no confirma', async () => {
    const res = await request();
    challenges[0].expiresAt = new Date(Date.now() - 1_000);

    await service.confirmFromInboundMessage('573001234567', `INGRESAR ${res.nonce}`);

    expect(challenges[0].status).toBe(WhatsAppLoginStatus.EXPIRED);
  });

  it('identidad no registrada: emite challenge pero nunca confirma', async () => {
    userQueryBuilder.getOne.mockResolvedValueOnce(null);

    const res = await service.requestChallenge('0000000000', device);
    expect(res.nonce).toBeDefined(); // respuesta indistinguible (anti-enumeration)

    await service.confirmFromInboundMessage('573001234567', `INGRESAR ${res.nonce}`);

    const status = await service.getStatus(res.challengeId, device);
    expect(status.status).toBe(WhatsAppLoginStatus.PENDING);
  });

  it('rate limit por identidad', async () => {
    cacheService.get.mockResolvedValue({ count: 3 } as any);

    await expect(request()).rejects.toMatchObject({ errorCode: 'WA_LOGIN_RATE_LIMIT' });
  });
});
