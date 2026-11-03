import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TokenService } from './token.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Role } from '../../roles/entities/role.entity';
import { User } from '../../users/entities/user.entity';
import { UserPermissionOverride } from '../../users/entities/user-permission-override.entity';
import { PermissionOverrideEffect } from '../../users/enums/permission-override-effect.enum';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions as P } from '../../permissions/enums/valid-permissions';

/**
 * Un permiso inactivo no entra al token: ni por un rol activo que lo tenga
 * asignado, ni por una excepción GRANT, ni en la cuenta del complejo. La
 * renovación vuelve a leer roles y permisos, así que un cambio de estado se
 * refleja en el siguiente token.
 */
describe('TokenService — permisos inactivos', () => {
  let service: TokenService;
  let signed: any[];

  const device: DeviceInfo = {
    fingerprint: 'fp-1',
    userAgent: 'jest',
    ip: '10.0.0.1',
    platform: 'android',
    deviceId: 'dev-1',
  };
  const perm = (name: P, status = true) => ({ name, status });
  const userWith = (permissions: Array<{ name: P; status: boolean }>) =>
    ({
      id: 'user-1',
      email: 'ana@example.com',
      tokenVersion: 3,
      complexId: 'complex-1',
      userRoles: [
        {
          role: {
            name: ValidRoles.GROWTH_MANAGER_ROL,
            status: true,
            permissions,
          },
        },
      ],
    }) as unknown as User;

  const jwtService = {
    signAsync: jest.fn(async (payload: any) => {
      signed.push(payload);
      return `jwt-${signed.length}`;
    }),
    verifyAsync: jest.fn(async (): Promise<any> => ({
      sub: 'user-1',
      type: 'refresh',
      entityType: 'user',
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
  const roleRepo = { findOne: jest.fn(async (): Promise<any> => null) };
  const overrideRepo = {
    find: jest.fn(async (): Promise<Partial<UserPermissionOverride>[]> => []),
  };

  beforeEach(async () => {
    signed = [];
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TokenService,
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
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        {
          provide: getRepositoryToken(UserPermissionOverride),
          useValue: overrideRepo,
        },
      ],
    }).compile();
    service = module.get(TokenService);
  });

  const access = () => signed[0];

  it('1. rol activo con permiso activo: el permiso va en el token', async () => {
    await service.generateTokenPair(
      userWith([perm(P.IMPORT_GROWTH_DATA)]),
      device,
    );
    expect(access().permissions).toEqual([P.IMPORT_GROWTH_DATA]);
  });

  it('2 y 3. rol activo con permiso inactivo (también uno nuevo): no entra al token', async () => {
    await service.generateTokenPair(
      userWith([
        perm(P.IMPORT_GROWTH_DATA),
        perm(P.VIEW_GROWTH_ACTIVITY, false),
        perm(P.MERGE_GROWTH_DUPLICATES, false), // recién creado, inactivo
      ]),
      device,
    );
    expect(access().permissions).toEqual([P.IMPORT_GROWTH_DATA]);
  });

  it('una excepción GRANT no habilita un permiso inactivo; DENY sigue quitando', async () => {
    overrideRepo.find.mockResolvedValueOnce([
      {
        effect: PermissionOverrideEffect.GRANT,
        permission: { name: P.VIEW_GROWTH_ACTIVITY, status: false } as never,
      },
      {
        effect: PermissionOverrideEffect.GRANT,
        permission: { name: P.VIEW_GROWTH_TEAM, status: true } as never,
      },
      {
        effect: PermissionOverrideEffect.DENY,
        permission: { name: P.IMPORT_GROWTH_DATA, status: false } as never,
      },
    ]);
    await service.generateTokenPair(
      userWith([perm(P.IMPORT_GROWTH_DATA)]),
      device,
    );
    expect(access().permissions).toEqual([P.VIEW_GROWTH_TEAM]);
  });

  it('cuenta del complejo: el permiso inactivo de COMPLEX_ROL no entra', async () => {
    roleRepo.findOne.mockResolvedValueOnce({
      name: ValidRoles.COMPLEX_ROL,
      permissions: [perm(P.VIEW_PACKAGES), perm(P.VIEW_VISITS, false)],
    });
    await service.generateTokenPairForComplex(
      { id: 'complex-1', email: 'c@example.com', tokenVersion: 0 } as never,
      device,
    );
    expect(access().permissions).toEqual([P.VIEW_PACKAGES]);
  });

  it('4, 5 y 7. la renovación recalcula: activar o desactivar se refleja en el siguiente token', async () => {
    const stored = (status: boolean) => ({
      id: 'rt-1',
      user: userWith([
        perm(P.IMPORT_GROWTH_DATA),
        perm(P.VIEW_GROWTH_ACTIVITY, status),
      ]),
      sessionId: 'sess-1',
      deviceFingerprint: 'fp-1',
      rememberMe: true,
      refreshExpiry: '180d',
      roleScope: null,
    });
    refreshTokenRepo.findOne.mockResolvedValueOnce(stored(false));
    await service.rotateRefreshToken('rt-viejo', device);
    expect(access().permissions).toEqual([P.IMPORT_GROWTH_DATA]);

    signed = [];
    refreshTokenRepo.findOne.mockResolvedValueOnce(stored(true));
    await service.rotateRefreshToken('rt-viejo-2', device);
    expect(access().permissions.sort()).toEqual(
      [P.IMPORT_GROWTH_DATA, P.VIEW_GROWTH_ACTIVITY].sort(),
    );
  });

  it('el token lleva la versión vigente del usuario (base de la invalidación)', async () => {
    await service.generateTokenPair(userWith([]), device);
    expect(access().tokenVersion).toBe(3);
  });
});
