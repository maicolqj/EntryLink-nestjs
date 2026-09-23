import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TokenService } from './token.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Role } from '../../roles/entities/role.entity';
import { User } from '../../users/entities/user.entity';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { RESIDENT_SESSION_ROLES } from '../constants/resident-session.constants';

/**
 * El alcance de la sesión (`roleScope`) y su supervivencia a la rotación.
 *
 * Es la garantía que impide que una cuenta que reside Y administra escale de
 * residente a administrador: los canales de residente prueban posesión del
 * teléfono, no la contraseña.
 */
describe('TokenService — alcance de roles de la sesión', () => {
  let service: TokenService;

  const device: DeviceInfo = {
    fingerprint: 'fp-1',
    userAgent: 'jest',
    ip: '10.0.0.1',
    platform: 'android',
    deviceId: 'dev-1',
  };

  // Administradora que además vive en el conjunto: los dos roles en la cuenta.
  const user = {
    id: 'user-1',
    email: 'ana@example.com',
    tokenVersion: 0,
    complexId: 'complex-1',
    userRoles: [
      {
        role: {
          name: ValidRoles.RESIDENT_ROL,
          permissions: [{ name: ValidPermissions.VIEW_PACKAGES }],
        },
      },
      {
        role: {
          name: ValidRoles.SUPER_ADMIN_ROL,
          permissions: [{ name: ValidPermissions.SUPERADMIN }],
        },
      },
    ],
  } as unknown as User;

  /** Payloads firmados, para poder inspeccionar qué llevó cada access token. */
  let signed: any[];
  let rows: any[];

  const jwtService = {
    signAsync: jest.fn(async (payload: any) => {
      signed.push(payload);
      return `jwt-${signed.length}`;
    }),
    // `Promise<any>`: cada prueba devuelve el payload que necesita, y algunas
    // agregan el complejo de la sesión.
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
    save: jest.fn(async (row: any) => {
      rows.push(row);
      return row;
    }),
    findOne: jest.fn(async () => null),
    update: jest.fn(async () => ({ affected: 1 })),
  };

  const cacheService = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };

  const emptyRepo = { findOne: jest.fn(async () => null) };

  beforeEach(async () => {
    signed = [];
    rows = [];
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          // Solo los secretos: las vigencias deben salir de AUTH_CONSTANTS.
          useValue: {
            get: (key: string) =>
              key.endsWith('_SECRET') ? 'secreto-de-prueba' : undefined,
          },
        },
        { provide: CacheService, useValue: cacheService },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepo,
        },
        {
          provide: getRepositoryToken(ResidentialComplex),
          useValue: emptyRepo,
        },
        { provide: getRepositoryToken(Role), useValue: emptyRepo },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  /** El primer payload firmado es siempre el access token. */
  const accessPayload = () => signed[0];

  it('sin alcance, el token sale con todos los roles de la cuenta', async () => {
    await service.generateTokenPair(user, device);

    expect(accessPayload().roles).toEqual([
      ValidRoles.RESIDENT_ROL,
      ValidRoles.SUPER_ADMIN_ROL,
    ]);
    expect(rows[0].roleScope).toBeNull();
  });

  it('con alcance de residente, el token deja fuera el rol administrativo', async () => {
    await service.generateTokenPair(
      user,
      device,
      false,
      'user',
      undefined,
      RESIDENT_SESSION_ROLES,
    );

    expect(accessPayload().roles).toEqual([ValidRoles.RESIDENT_ROL]);
    expect(rows[0].roleScope).toEqual([...RESIDENT_SESSION_ROLES]);
  });

  it('los permisos también se recortan, no solo los roles', async () => {
    // Si los permisos se derivaran de todos los roles, el token diría
    // "residente" pero cargaría SUPERADMIN.
    await service.generateTokenPair(
      user,
      device,
      false,
      'user',
      undefined,
      RESIDENT_SESSION_ROLES,
    );

    expect(accessPayload().permissions).toEqual([
      ValidPermissions.VIEW_PACKAGES,
    ]);
  });

  it('la rotación conserva el alcance: no devuelve los roles administrativos', async () => {
    // Regresión: rotateRefreshToken reconstruye el access token leyendo los
    // roles de la base. Sin leer el alcance de la fila, la sesión de residente
    // recuperaba SUPER_ADMIN_ROL en el primer refresh —quince minutos después
    // de entrar, sin que nadie lo notara—.
    refreshTokenRepo.findOne.mockResolvedValueOnce({
      id: 'rt-1',
      user,
      sessionId: 'sess-1',
      deviceFingerprint: 'fp-1',
      rememberMe: true,
      refreshExpiry: '180d',
      roleScope: [...RESIDENT_SESSION_ROLES],
    } as any);

    await service.rotateRefreshToken('rt-viejo', device);

    expect(accessPayload().roles).toEqual([ValidRoles.RESIDENT_ROL]);
    expect(accessPayload().permissions).toEqual([
      ValidPermissions.VIEW_PACKAGES,
    ]);

    // Y el alcance viaja a la fila nueva, para la rotación siguiente.
    expect(rows[0].roleScope).toEqual([...RESIDENT_SESSION_ROLES]);
  });

  // ── Complejo de la sesión ─────────────────────────────────────────────────

  it('el complejo del canal manda sobre el de la cuenta', async () => {
    // `users.complex_id` viene vacío para quien administra; el conjunto donde
    // vive sale de su ficha de residente.
    await service.generateTokenPair(
      { ...user, complexId: undefined } as unknown as User,
      device,
      false,
      'user',
      undefined,
      RESIDENT_SESSION_ROLES,
      'complejo-de-su-casa',
    );

    expect(accessPayload().complexId).toBe('complejo-de-su-casa');
  });

  it('sin complejo del canal se conserva el de la cuenta', async () => {
    await service.generateTokenPair(user, device);

    expect(accessPayload().complexId).toBe('complex-1');
  });

  it('la rotación conserva el complejo de la sesión', async () => {
    // Regresión: la rotación reconstruye el access token desde la base, donde
    // `users.complex_id` sigue vacío. Sin leerlo del refresh token, la sesión
    // perdía el conjunto en el primer refresh y el residente se quedaba sin
    // unidad y con la bandeja vacía, sin ningún error.
    jwtService.verifyAsync.mockResolvedValueOnce({
      sub: 'user-1',
      type: 'refresh',
      entityType: 'user',
      complexId: 'complejo-de-su-casa',
      sessionId: 'sess-1',
      tokenFamily: 'fam-1',
      deviceFingerprint: 'fp-1',
    });

    refreshTokenRepo.findOne.mockResolvedValueOnce({
      id: 'rt-1',
      user: { ...user, complexId: undefined },
      sessionId: 'sess-1',
      deviceFingerprint: 'fp-1',
      rememberMe: true,
      refreshExpiry: '180d',
      roleScope: [...RESIDENT_SESSION_ROLES],
    } as any);

    await service.rotateRefreshToken('rt-viejo', device);

    expect(accessPayload().complexId).toBe('complejo-de-su-casa');
    // Y viaja al refresh nuevo, para la rotación siguiente.
    expect(signed[1].complexId).toBe('complejo-de-su-casa');
  });

  it('la rotación de una sesión sin alcance sigue entregando todos los roles', async () => {
    refreshTokenRepo.findOne.mockResolvedValueOnce({
      id: 'rt-1',
      user,
      sessionId: 'sess-1',
      deviceFingerprint: 'fp-1',
      rememberMe: false,
      refreshExpiry: '7d',
      roleScope: null,
    } as any);

    await service.rotateRefreshToken('rt-viejo', device);

    expect(accessPayload().roles).toEqual([
      ValidRoles.RESIDENT_ROL,
      ValidRoles.SUPER_ADMIN_ROL,
    ]);
    expect(rows[0].roleScope).toBeNull();
  });
});
