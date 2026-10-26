import {
  ANNOUNCEMENT_ENTITY_TYPE,
  PlatformAnnouncementsService,
} from './platform-announcements.service';
import { PlatformAnnouncement } from '../entities/platform-announcement.entity';
import { SendPlatformAnnouncementDto } from '../dto/platform-announcement.inputs';
import {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementStatus,
  AnnouncementTargetMode,
} from '../enums/platform-announcement.enums';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { PlatformAnnouncementErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const CX_A = '11111111-1111-1111-1111-111111111111';
const CX_B = '22222222-2222-2222-2222-222222222222';

const superAdmin: JwtAccessPayload = {
  sub: ADMIN_ID,
  email: 'admin@example.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles: [ValidRoles.SUPER_ADMIN_ROL],
  permissions: [],
};

const file = (name: string) =>
  ({ buffer: Buffer.from('x'), originalname: name }) as Express.Multer.File;

const dto = (
  overrides: Partial<SendPlatformAnnouncementDto> = {},
): SendPlatformAnnouncementDto => ({
  category: AnnouncementCategory.PROMOTION,
  title: '  Nuevo módulo  ',
  body: 'Ya pueden usar votaciones',
  audience: AnnouncementAudience.ALL,
  target: { mode: AnnouncementTargetMode.ALL_COMPLEXES },
  ...overrides,
});

/** El reparto corre con `void`: hay que dejar que termine. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(options?: {
  complexes?: { id: string; name: string }[];
  residentsByComplex?: Record<string, string[]>;
  notifyFails?: string[];
}) {
  const complexes = options?.complexes ?? [
    { id: CX_A, name: 'Alameda' },
    { id: CX_B, name: 'Bosques' },
  ];

  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(complexes),
  };
  const complexRepo = { createQueryBuilder: jest.fn(() => qb) };

  const announcementRepo = {
    create: jest.fn((data: Partial<PlatformAnnouncement>) => data),
    save: jest.fn((data: Partial<PlatformAnnouncement>) =>
      Promise.resolve({ id: 'ann-1', createdAt: new Date(), ...data }),
    ),
    update: jest.fn().mockResolvedValue(undefined),
  };

  const residentsByComplex = options?.residentsByComplex ?? {};
  const residentRepo = {
    find: jest.fn(({ where }: { where: { complexId: string } }) =>
      Promise.resolve(
        (residentsByComplex[where.complexId] ?? []).map((userId) => ({
          userId,
        })),
      ),
    ),
  };

  const notifyFails = new Set(options?.notifyFails ?? []);
  const notificationsService = {
    notify: jest.fn(({ complexId, userIds }) =>
      notifyFails.has(complexId as string)
        ? Promise.reject(new Error('FCM caído'))
        : Promise.resolve((userIds as string[]).map((id) => ({ id }))),
    ),
  };

  const storageService = {
    buildFolder: jest.fn(() => 'EntryLink/_platform/announcements'),
    uploadBuffer: jest.fn((_b: Buffer, folder: string, name: string) =>
      Promise.resolve({
        url: `https://files.alternaqj.com/${folder}/${name}`,
        publicId: `${folder}/${name}`,
      }),
    ),
    keyFromPublicUrl: jest.fn((url: string) => url),
    deleteByPublicId: jest.fn().mockResolvedValue(undefined),
  };

  const service = new PlatformAnnouncementsService(
    announcementRepo as never,
    complexRepo as never,
    residentRepo as never,
    notificationsService as never,
    storageService as never,
  );

  return {
    service,
    qb,
    announcementRepo,
    residentRepo,
    notificationsService,
    storageService,
  };
}

describe('PlatformAnnouncementsService', () => {
  describe('resolveRecipients', () => {
    it('a la administración le llega por la cuenta del complejo, no por un usuario', async () => {
      const { service, residentRepo } = setup();

      const ids = await service.resolveRecipients(
        CX_A,
        AnnouncementAudience.ADMINISTRATION,
      );

      expect(ids).toEqual([CX_A]);
      expect(residentRepo.find).not.toHaveBeenCalled();
    });

    it('a los residentes les llega por su ficha activa, sin la administración', async () => {
      const { service } = setup({
        residentsByComplex: { [CX_A]: ['u1', 'u2'] },
      });

      const ids = await service.resolveRecipients(
        CX_A,
        AnnouncementAudience.RESIDENTS,
      );

      expect(ids).toEqual(['u1', 'u2']);
    });

    it('con ambos no repite a quien tiene dos residencias en el conjunto', async () => {
      const { service } = setup({
        residentsByComplex: { [CX_A]: ['u1', 'u1', 'u2'] },
      });

      const ids = await service.resolveRecipients(
        CX_A,
        AnnouncementAudience.ALL,
      );

      expect(ids).toEqual([CX_A, 'u1', 'u2']);
    });
  });

  describe('resolveComplexes', () => {
    it('una selección vacía no consulta ni devuelve nada', async () => {
      const { service, qb } = setup();

      const result = await service.resolveComplexes({
        mode: AnnouncementTargetMode.SELECTED,
        complexIds: [],
      });

      expect(result).toEqual([]);
      expect(qb.getMany).not.toHaveBeenCalled();
    });

    it('los filtros vacíos no filtran', async () => {
      const { service, qb } = setup();

      await service.resolveComplexes({
        mode: AnnouncementTargetMode.FILTERED,
        plans: [],
        statuses: [],
      });

      // Solo la regla fija: nunca los que esperan revisión.
      expect(qb.andWhere).toHaveBeenCalledTimes(1);
    });
  });

  describe('send', () => {
    it('sin conjuntos destino no guarda ni sube nada', async () => {
      const { service, announcementRepo, storageService } = setup({
        complexes: [],
      });

      await expect(
        service.send(dto(), [file('a.png')], superAdmin),
      ).rejects.toMatchObject({
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_NO_TARGETS,
      });
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
      expect(announcementRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza más de cuatro imágenes', async () => {
      const { service } = setup();
      const files = ['1', '2', '3', '4', '5'].map((n) => file(`${n}.png`));

      await expect(
        service.send(dto(), files, superAdmin),
      ).rejects.toMatchObject({
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_TOO_MANY_IMAGES,
      });
    });

    it('guarda el comunicado con las imágenes y lo reparte a cada conjunto', async () => {
      const { service, announcementRepo, notificationsService } = setup({
        residentsByComplex: { [CX_A]: ['u1'], [CX_B]: ['u2', 'u3'] },
      });

      const saved = await service.send(
        dto(),
        [file('a.png'), file('b.jpg')],
        superAdmin,
      );
      await flush();

      expect(saved.title).toBe('Nuevo módulo');
      expect(saved.imageUrls).toHaveLength(2);
      expect(saved.complexIds).toEqual([CX_A, CX_B]);
      expect(saved.createdByUserId).toBe(ADMIN_ID);

      expect(notificationsService.notify).toHaveBeenCalledTimes(2);
      expect(notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          complexId: CX_B,
          userIds: [CX_B, 'u2', 'u3'],
          type: NotificationType.PLATFORM_ANNOUNCEMENT,
          entityType: ANNOUNCEMENT_ENTITY_TYPE,
          entityId: 'ann-1',
        }),
      );
      expect(announcementRepo.update).toHaveBeenCalledWith(
        'ann-1',
        expect.objectContaining({
          status: AnnouncementStatus.SENT,
          recipientsCount: 5,
        }),
      );
    });

    it('un conjunto que falla no frena a los demás', async () => {
      const { service, announcementRepo } = setup({ notifyFails: [CX_A] });

      await service.send(
        dto({ audience: AnnouncementAudience.ADMINISTRATION }),
        [],
        superAdmin,
      );
      await flush();

      expect(announcementRepo.update).toHaveBeenCalledWith(
        'ann-1',
        expect.objectContaining({
          status: AnnouncementStatus.SENT,
          recipientsCount: 1,
        }),
      );
    });

    it('si el guardado falla borra de R2 las imágenes recién subidas', async () => {
      const { service, announcementRepo, storageService } = setup();
      announcementRepo.save.mockRejectedValueOnce(new Error('BD caída'));

      await expect(
        service.send(dto(), [file('a.png')], superAdmin),
      ).rejects.toThrow('BD caída');
      expect(storageService.deleteByPublicId).toHaveBeenCalledTimes(1);
    });
  });
});
