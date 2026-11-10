import { SecurityPostsService } from './security-posts.service';
import { SecurityPost } from '../entities/security-post.entity';
import { SecurityPostErrorCode } from '../../shared/constans/error-codes.constants';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const COMPLEX_ID = '11111111-1111-1111-1111-111111111111';
const GUARD_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';

const user = (
  sub: string,
  roles: ValidRoles[],
  complexId: string | undefined = COMPLEX_ID,
): JwtAccessPayload => ({
  sub,
  email: `${sub}@example.com`,
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles,
  permissions: [],
  complexId,
});

const post = (overrides: Partial<SecurityPost> = {}): SecurityPost =>
  Object.assign(new SecurityPost(), {
    id: 'post-1',
    complexId: COMPLEX_ID,
    name: 'PORTERÍA NORTE',
    phoneNumber: null,
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
    ...overrides,
  });

function setup(options?: { found?: SecurityPost | null; taken?: number }) {
  const postRepo = {
    findOne: jest.fn().mockResolvedValue(options?.found ?? null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(options?.taken ?? 0),
    create: jest.fn((data: Partial<SecurityPost>) =>
      Object.assign(new SecurityPost(), data),
    ),
    save: jest.fn((data: SecurityPost) => Promise.resolve(data)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
  const guardRepo = {
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
  };
  const residentRepo = { count: jest.fn().mockResolvedValue(1) };
  const complexService = {
    assertComplexAccess: jest.fn().mockResolvedValue(undefined),
  };
  const socketService = { emitToComplex: jest.fn() };

  const service = new SecurityPostsService(
    postRepo as never,
    guardRepo as never,
    residentRepo as never,
    complexService as never,
    socketService as never,
  );
  return { service, postRepo, guardRepo, residentRepo, socketService };
}

describe('SecurityPostsService', () => {
  describe('select (el vigilante dice en qué portería está)', () => {
    it('guarda la portería de su conjunto', async () => {
      const { service, postRepo, guardRepo } = setup({ found: post() });

      await service.select('post-1', user(GUARD_ID, [ValidRoles.SECURITY_ROL]));

      const [[findArgs]] = postRepo.findOne.mock.calls as [
        [{ where: Record<string, unknown> }],
      ];
      expect(findArgs.where).toMatchObject({
        id: 'post-1',
        complexId: COMPLEX_ID,
        isActive: true,
      });
      expect(guardRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: GUARD_ID,
          securityPostId: 'post-1',
        }),
        ['userId'],
      );
    });

    it('una portería de otro conjunto o apagada no se puede elegir', async () => {
      const { service, guardRepo } = setup({ found: null });
      await expect(
        service.select('post-x', user(GUARD_ID, [ValidRoles.SECURITY_ROL])),
      ).rejects.toMatchObject({
        errorCode: SecurityPostErrorCode.SECURITY_POST_NOT_FOUND,
      });
      expect(guardRepo.upsert).not.toHaveBeenCalled();
    });

    it('null lo saca de la portería', async () => {
      const { service, guardRepo } = setup();
      await service.select(null, user(GUARD_ID, [ValidRoles.SECURITY_ROL]));
      expect(guardRepo.delete).toHaveBeenCalledWith({ userId: GUARD_ID });
    });
  });

  describe('administración', () => {
    const admin = () => user(ADMIN_ID, [ValidRoles.COMPLEX_ROL]);

    it('no deja dos porterías con el mismo nombre', async () => {
      const { service } = setup({ taken: 1 });
      await expect(
        service.create(
          { complexId: COMPLEX_ID, name: ' portería  norte ' },
          admin(),
        ),
      ).rejects.toMatchObject({
        errorCode: SecurityPostErrorCode.SECURITY_POST_NAME_TAKEN,
      });
    });

    it('crea normalizada y avisa al conjunto', async () => {
      const { service, socketService } = setup();
      const created = await service.create(
        {
          complexId: COMPLEX_ID,
          name: ' portería  norte ',
          phoneNumber: '300 123 4567',
        },
        admin(),
      );
      expect(created.name).toBe('PORTERÍA NORTE');
      expect(created.phoneNumber).toBe('3001234567');
      expect(socketService.emitToComplex).toHaveBeenCalledWith(
        COMPLEX_ID,
        SocketEvent.SECURITY_POSTS_UPDATED,
        { complexId: COMPLEX_ID },
      );
    });

    it('apagar una portería saca a sus vigilantes', async () => {
      const { service, guardRepo } = setup({ found: post() });
      await service.update({ id: 'post-1', isActive: false }, admin());
      expect(guardRepo.delete).toHaveBeenCalledWith({
        securityPostId: 'post-1',
      });
    });
  });

  describe('list', () => {
    it('el residente solo ve las activas', async () => {
      const { service, postRepo } = setup();
      await service.list(COMPLEX_ID, user('res', [ValidRoles.RESIDENT_ROL]));
      const [[findArgs]] = postRepo.find.mock.calls as [
        [{ where: Record<string, unknown> }],
      ];
      expect(findArgs.where).toMatchObject({ isActive: true });
    });

    it('quien no vive en el conjunto no las ve', async () => {
      const { service, residentRepo } = setup();
      residentRepo.count.mockResolvedValue(0);
      await expect(
        service.list(COMPLEX_ID, user('otro', [ValidRoles.RESIDENT_ROL])),
      ).rejects.toBeDefined();
    });
  });
});
