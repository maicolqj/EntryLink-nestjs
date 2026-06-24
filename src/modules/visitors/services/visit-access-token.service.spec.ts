import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { VisitAccessTokenService } from './visit-access-token.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';

/**
 * Verifica las garantías de seguridad del token: firma válida, atadura al
 * visitId y uso único respaldado por cache.
 */
describe('VisitAccessTokenService', () => {
  let service: VisitAccessTokenService;

  // Cache en memoria que imita la API de CacheService (set/get/delete por jti).
  const store = new Map<string, unknown>();
  const cacheMock = {
    set: jest.fn(async ({ key, data }: any) => { store.set(`${key.prefix}:${key.key}`, data); }),
    get: jest.fn(async ({ key }: any) => store.get(`${key.prefix}:${key.key}`) ?? null),
    delete: jest.fn(async ({ key }: any) => { store.delete(`${key.prefix}:${key.key}`); }),
  };

  beforeEach(async () => {
    store.clear();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        VisitAccessTokenService,
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    service = module.get(VisitAccessTokenService);
  });

  it('emite un token que verifica con su visitId y visitorId', async () => {
    const token = await service.issue('visit-1', 'vtr-1');
    const payload = await service.verify(token);

    expect(payload).toMatchObject({ visitId: 'visit-1', visitorId: 'vtr-1' });
    expect(payload?.jti).toBeDefined();
  });

  it('uso único: tras consume() el mismo token ya no verifica', async () => {
    const token = await service.issue('visit-1', 'vtr-1');
    const payload = await service.verify(token);

    await service.consume(payload!.jti);

    expect(await service.verify(token)).toBeNull();
  });

  it('token con firma de otro secreto → null', async () => {
    const foreign = new JwtService({});
    const token = await foreign.signAsync(
      { visitId: 'visit-1', visitorId: 'vtr-1', jti: 'x', type: 'visit_access' },
      { secret: 'otro-secreto', algorithm: 'HS256' },
    );
    // Aunque registremos el jti en cache, la firma no coincide con JWT_ACCESS_SECRET.
    store.set('visit-access:x', { visitId: 'visit-1' });

    expect(await service.verify(token)).toBeNull();
  });

  it('JWT de otro tipo (no visit_access) → null aunque la firma sea válida', async () => {
    const jwt = new JwtService({});
    const token = await jwt.signAsync(
      { visitId: 'visit-1', jti: 'y', type: 'access' },
      { secret: 'test-secret', algorithm: 'HS256' },
    );
    store.set('visit-access:y', { visitId: 'visit-1' });

    expect(await service.verify(token)).toBeNull();
  });
});
