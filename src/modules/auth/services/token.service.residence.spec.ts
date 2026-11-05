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
        {
          provide: CacheService,
          useValue: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
        },
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
});
