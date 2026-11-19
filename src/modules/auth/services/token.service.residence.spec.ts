import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TokenService } from './token.service';
import { ResidentTenancyService } from './resident-tenancy.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Role } from '../../roles/entities/role.entity';
import { UserPermissionOverride } from '../../users/entities/user-permission-override.entity';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { AuthErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Una sesión de residente solo se renueva mientras su residencia en ese
 * conjunto siga activa. Cubre también las sesiones abiertas antes de que
 * suspender una ficha empezara a cerrarlas.
 */
describe('TokenService — renovación con residencia suspendida', () => {
  let service: TokenService;
  let signed: any[];
  let activeResidence: boolean;

  const device: DeviceInfo = {
    fingerprint: 'fp-1',
    userAgent: 'jest',
    ip: '10.0.0.1',
    platform: 'android',
    deviceId: 'dev-1',
  };

  const jwtService = {
    signAsync: jest.fn(async (payload: any) => {
      signed.push(payload);
      return `jwt-${signed.length}`;
    }),
    verifyAsync: jest.fn(async (): Promise<any> => ({
      sub: 'user-1',
      type: 'refresh',
      entityType: 'user',
      complexId: 'complex-1',
      sessionId: 'sess-1',
      tokenFamily: 'fam-1',
      deviceFingerprint: 'fp-1',
    })),
  };
  const refreshTokenRepo = {
    save: jest.fn(async (row: any) => row),
    findOne: jest.fn(async (): Promise<any> => null),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const cache = {
    get: jest.fn(async (): Promise<any> => undefined),
    set: jest.fn(),
    delete: jest.fn(),
  };
  const tenancy = {
    hasActiveResidence: jest.fn(async () => activeResidence),
  };

  const stored = (roleScope: ValidRoles[] | null) => ({
    id: 'rt-1',
    user: {
      id: 'user-1',
      email: 'ana@example.com',
      tokenVersion: 0,
      status: 'active',
      complexId: null,
      userRoles: [
        {
          role: {
            name: ValidRoles.RESIDENT_ROL,
            status: true,
            permissions: [],
          },
        },
      ],
    },
    sessionId: 'sess-1',
    deviceFingerprint: 'fp-1',
    rememberMe: true,
    refreshExpiry: '180d',
    roleScope,
  });

  beforeEach(async () => {
    signed = [];
    activeResidence = true;
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: ResidentTenancyService, useValue: tenancy },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key.endsWith('_SECRET') ? 'secreto-de-prueba' : undefined,
          },
        },
        { provide: CacheService, useValue: cache },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepo,
        },
        {
          provide: getRepositoryToken(ResidentialComplex),
          useValue: { findOne: jest.fn(async () => null) },
        },
        {
          provide: getRepositoryToken(Role),
          useValue: { findOne: jest.fn(async () => null) },
        },
        {
          provide: getRepositoryToken(UserPermissionOverride),
          useValue: { find: jest.fn(async () => []) },
        },
      ],
    }).compile();
    service = module.get(TokenService);
  });

  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'OK';
    } catch (e: any) {
      return e?.errorCode ?? e?.message;
    }
  };

  it('residencia activa: renueva y conserva el conjunto', async () => {
    refreshTokenRepo.findOne.mockResolvedValueOnce(
      stored([ValidRoles.RESIDENT_ROL]),
    );

    await service.rotateRefreshToken('rt-viejo', device);

    expect(tenancy.hasActiveResidence).toHaveBeenCalledWith(
      'user-1',
      'complex-1',
    );
    expect(signed[0].complexId).toBe('complex-1');
  });

  it('residencia suspendida: no renueva, revoca la familia y no firma tokens', async () => {
    activeResidence = false;
    refreshTokenRepo.findOne.mockResolvedValueOnce(
      stored([ValidRoles.RESIDENT_ROL]),
    );

    const code = await codeOf(service.rotateRefreshToken('rt-viejo', device));

    expect(code).toBe(AuthErrorCode.SESSION_TERMINATED);
    expect(signed).toHaveLength(0);
    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ tokenFamily: 'fam-1' }),
      expect.objectContaining({ revokedReason: 'residence_not_active' }),
    );
  });

  it('sesión sin alcance de residente (panel): no consulta la residencia', async () => {
    activeResidence = false;
    refreshTokenRepo.findOne.mockResolvedValueOnce(stored(null));

    await service.rotateRefreshToken('rt-viejo', device);

    expect(tenancy.hasActiveResidence).not.toHaveBeenCalled();
    expect(signed.length).toBeGreaterThan(0);
  });
  describe('cambio de conjunto (complexIdOverride)', () => {
    const opts = { complexIdOverride: 'complex-2', requesterUserId: 'user-1' };

    it('emite el conjunto nuevo en access y refresh, con la misma familia, sesión y alcance', async () => {
      const row = stored([ValidRoles.RESIDENT_ROL]);
      refreshTokenRepo.findOne.mockResolvedValueOnce(row);

      const pair = await service.rotateRefreshToken('rt-viejo', device, opts);

      expect(tenancy.hasActiveResidence).toHaveBeenCalledWith(
        'user-1',
        'complex-2',
      );
      const access = signed.find((p) => p.type === 'access');
      const refresh = signed.find((p) => p.type === 'refresh');
      expect(access.complexId).toBe('complex-2');
      expect(access.roles).toEqual([ValidRoles.RESIDENT_ROL]);
      expect(refresh).toMatchObject({
        complexId: 'complex-2',
        tokenFamily: 'fam-1',
        sessionId: 'sess-1',
      });
      expect(pair.sessionId).toBe('sess-1');
      expect(refreshTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          roleScope: [ValidRoles.RESIDENT_ROL],
          tokenFamily: 'fam-1',
        }),
      );
    });

    it('sin residencia activa en el destino: RESIDENCE_NOT_AVAILABLE y no revoca la sesión', async () => {
      activeResidence = false;
      refreshTokenRepo.findOne.mockResolvedValueOnce(
        stored([ValidRoles.RESIDENT_ROL]),
      );

      const code = await codeOf(
        service.rotateRefreshToken('rt-viejo', device, opts),
      );

      expect(code).toBe(AuthErrorCode.RESIDENCE_NOT_AVAILABLE);
      expect(signed).toHaveLength(0);
      expect(refreshTokenRepo.update).not.toHaveBeenCalled();
    });

    it('sesión sin alcance de residente: COMPLEX_SWITCH_NOT_ALLOWED', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(stored(null));

      const code = await codeOf(
        service.rotateRefreshToken('rt-viejo', device, opts),
      );

      expect(code).toBe(AuthErrorCode.COMPLEX_SWITCH_NOT_ALLOWED);
      expect(signed).toHaveLength(0);
      expect(refreshTokenRepo.update).not.toHaveBeenCalled();
    });

    it('refresh de otra persona: COMPLEX_SWITCH_NOT_ALLOWED', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(
        stored([ValidRoles.RESIDENT_ROL]),
      );

      const code = await codeOf(
        service.rotateRefreshToken('rt-viejo', device, {
          complexIdOverride: 'complex-2',
          requesterUserId: 'otra-persona',
        }),
      );

      expect(code).toBe(AuthErrorCode.COMPLEX_SWITCH_NOT_ALLOWED);
      expect(signed).toHaveLength(0);
    });
  });
  describe('cambio de conjunto — revisión final', () => {
    const opts = { complexIdOverride: 'complex-2', requesterUserId: 'user-1' };
    const councilStored = () => {
      const row: any = stored([
        ValidRoles.RESIDENT_ROL,
        ValidRoles.COUNCIL_ROL,
      ]);
      row.user.userRoles.push({
        role: { name: ValidRoles.COUNCIL_ROL, status: true, permissions: [] },
      });
      return row;
    };

    it('el token del conjunto nuevo no lleva COUNCIL_ROL (el consejo no es de ese conjunto)', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(councilStored());

      await service.rotateRefreshToken('rt-viejo', device, opts);

      const access = signed.find((p) => p.type === 'access');
      expect(access.roles).toEqual([ValidRoles.RESIDENT_ROL]);
      expect(refreshTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ roleScope: [ValidRoles.RESIDENT_ROL] }),
      );
    });

    it('la renovación normal conserva COUNCIL_ROL', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(councilStored());

      await service.rotateRefreshToken('rt-viejo', device);

      const access = signed.find((p) => p.type === 'access');
      expect(access.roles).toEqual(
        expect.arrayContaining([
          ValidRoles.RESIDENT_ROL,
          ValidRoles.COUNCIL_ROL,
        ]),
      );
    });

    it('marca el refresh anterior con motivo complex_switched', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(
        stored([ValidRoles.RESIDENT_ROL]),
      );

      await service.rotateRefreshToken('rt-viejo', device, opts);

      expect(refreshTokenRepo.update).toHaveBeenCalledWith(
        'rt-1',
        expect.objectContaining({
          isRevoked: true,
          revokedReason: 'complex_switched',
        }),
      );
    });

    it('reintento en la ventana de gracia hacia el mismo conjunto: devuelve el mismo par', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(null);
      cache.get.mockResolvedValueOnce({
        accessToken: 'a-g',
        refreshToken: 'r-g',
        sessionId: 'sess-1',
        complexId: 'complex-2',
      });

      const pair = await service.rotateRefreshToken('rt-viejo', device, opts);

      expect(pair).toMatchObject({ accessToken: 'a-g', refreshToken: 'r-g' });
    });

    it('par en gracia de otro conjunto: pide reintentar sin revocar', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(null);
      cache.get.mockResolvedValueOnce({
        accessToken: 'a-g',
        refreshToken: 'r-g',
        sessionId: 'sess-1',
        complexId: 'complex-1',
      });

      const code = await codeOf(
        service.rotateRefreshToken('rt-viejo', device, opts),
      );

      expect(code).toBe(AuthErrorCode.COMPLEX_SWITCH_NOT_ALLOWED);
      expect(refreshTokenRepo.update).not.toHaveBeenCalled();
    });

    it('guarda el conjunto en el par de gracia', async () => {
      refreshTokenRepo.findOne.mockResolvedValueOnce(
        stored([ValidRoles.RESIDENT_ROL]),
      );

      await service.rotateRefreshToken('rt-viejo', device, opts);

      expect(cache.set).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ complexId: 'complex-2' }),
        }),
      );
    });
  });
});
