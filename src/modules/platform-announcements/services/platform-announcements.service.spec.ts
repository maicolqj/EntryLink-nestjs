import {
  ANNOUNCEMENT_ENTITY_TYPE,
  EMAIL_SPACING_MS,
  PlatformAnnouncementsService,
  decodeFileName,
} from './platform-announcements.service';
import { PlatformAnnouncement } from '../entities/platform-announcement.entity';
import { SendPlatformAnnouncementDto } from '../dto/platform-announcement.inputs';
import {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementChannel,
  AnnouncementStatus,
  AnnouncementTargetMode,
} from '../enums/platform-announcement.enums';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import {
  GeneralErrorCode,
  PlatformAnnouncementErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { SendPlatformAnnouncementJobPayload } from '../../../mail/constants/mail.constants';

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

const file = (name: string, size = 1024, mimetype = 'image/png') =>
  ({
    buffer: Buffer.from('x'),
    originalname: name,
    size,
    mimetype,
  }) as Express.Multer.File;

const MB = 1024 * 1024;

const resident: JwtAccessPayload = {
  ...superAdmin,
  sub: 'u1',
  roles: [ValidRoles.RESIDENT_ROL],
};

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
  complexes?: { id: string; name: string; email?: string | null }[];
  residentsByComplex?: Record<string, string[]>;
  notifyFails?: string[];
}) {
  const complexes = options?.complexes ?? [
    { id: CX_A, name: 'Alameda', email: 'admin@alameda.co' },
    { id: CX_B, name: 'Bosques', email: null },
  ];

  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(complexes),
  };
  const complexRepo = {
    createQueryBuilder: jest.fn(() => qb),
    find: jest.fn().mockResolvedValue(complexes),
  };

  const announcementRepo = {
    create: jest.fn((data: Partial<PlatformAnnouncement>) => data),
    save: jest.fn((data: Partial<PlatformAnnouncement>) =>
      Promise.resolve({ id: 'ann-1', createdAt: new Date(), ...data }),
    ),
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const notificationRepo = { exist: jest.fn().mockResolvedValue(false) };
  const mailService = {
    queuePlatformAnnouncementEmail: jest.fn().mockResolvedValue(undefined),
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
    notificationRepo as never,
    notificationsService as never,
    mailService as never,
    storageService as never,
  );

  return {
    service,
    qb,
    announcementRepo,
    residentRepo,
    notificationRepo,
    notificationsService,
    mailService,
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
        service.send(dto(), [file('a.png')], [], superAdmin),
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
        service.send(dto(), files, [], superAdmin),
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
        [],
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
        service.send(dto(), [file('a.png')], [], superAdmin),
      ).rejects.toThrow('BD caída');
      expect(storageService.deleteByPublicId).toHaveBeenCalledTimes(1);
    });
  });

  describe('correo', () => {
    it('sin canales sale solo como aviso, como antes', async () => {
      const { service, mailService } = setup();

      const saved = await service.send(dto(), [], [], superAdmin);
      await flush();

      expect(saved.channels).toEqual([AnnouncementChannel.NOTIFICATION]);
      expect(mailService.queuePlatformAnnouncementEmail).not.toHaveBeenCalled();
    });

    it('solo correo: un correo por conjunto con email, sin avisos', async () => {
      const { service, mailService, notificationsService, announcementRepo } =
        setup({
          complexes: [
            { id: CX_A, name: 'Alameda', email: 'admin@alameda.co' },
            { id: CX_B, name: 'Bosques', email: ' admin@bosques.co ' },
            { id: 'cx-c', name: 'Cedros', email: 'no-es-correo' },
          ],
        });

      await service.send(
        dto({ channels: [AnnouncementChannel.EMAIL] }),
        [],
        [file('Acta.pdf', 2 * MB, 'application/pdf')],
        superAdmin,
      );
      await flush();

      expect(notificationsService.notify).not.toHaveBeenCalled();
      const calls = mailService.queuePlatformAnnouncementEmail.mock.calls as [
        SendPlatformAnnouncementJobPayload,
        number,
      ][];
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toMatchObject({
        email: 'admin@alameda.co',
        complexName: 'Alameda',
        attachments: [
          expect.objectContaining({
            name: 'Acta.pdf',
            mimeType: 'application/pdf',
          }),
        ],
      });
      // El segundo sale después: el proveedor limita correos por segundo.
      expect(calls[1][0].email).toBe('admin@bosques.co');
      expect(calls[1][1]).toBe(EMAIL_SPACING_MS);
      expect(announcementRepo.update).toHaveBeenCalledWith(
        'ann-1',
        expect.objectContaining({ emailsCount: 2, recipientsCount: 0 }),
      );
    });

    it('solo correo sin ningún email registrado se rechaza antes de subir nada', async () => {
      const { service, storageService } = setup({
        complexes: [{ id: CX_B, name: 'Bosques', email: null }],
      });

      await expect(
        service.send(
          dto({ channels: [AnnouncementChannel.EMAIL] }),
          [],
          [file('a.pdf', 1024, 'application/pdf')],
          superAdmin,
        ),
      ).rejects.toMatchObject({
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_NO_EMAILS,
      });
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('rechaza adjuntos que suman más de 20 MB', async () => {
      const { service } = setup();
      const big = ['a', 'b', 'c'].map((n) =>
        file(`${n}.pdf`, 8 * MB, 'application/pdf'),
      );

      await expect(
        service.send(dto(), [], big, superAdmin),
      ).rejects.toMatchObject({
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_FILES_LIMIT,
      });
    });

    it('si el guardado falla borra de R2 imágenes y adjuntos', async () => {
      const { service, announcementRepo, storageService } = setup();
      announcementRepo.save.mockRejectedValueOnce(new Error('BD caída'));

      await expect(
        service.send(
          dto(),
          [file('a.png')],
          [file('b.pdf', 1024, 'application/pdf')],
          superAdmin,
        ),
      ).rejects.toThrow('BD caída');
      expect(storageService.deleteByPublicId).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveAttachment', () => {
    const announcement = {
      id: 'ann-1',
      attachments: [
        { key: 'k/acta.pdf', name: 'acta.pdf', mimeType: 'application/pdf' },
      ],
    };

    it('el personal de la plataforma descarga sin haberlo recibido', async () => {
      const { service, announcementRepo, notificationRepo } = setup();
      announcementRepo.findOne.mockResolvedValue(announcement);

      const a = await service.resolveAttachment('ann-1', 0, superAdmin);

      expect(a.key).toBe('k/acta.pdf');
      expect(notificationRepo.exist).not.toHaveBeenCalled();
    });

    it('quien recibió el aviso lo descarga', async () => {
      const { service, announcementRepo, notificationRepo } = setup();
      announcementRepo.findOne.mockResolvedValue(announcement);
      notificationRepo.exist.mockResolvedValue(true);

      await expect(
        service.resolveAttachment('ann-1', 0, resident),
      ).resolves.toMatchObject({ name: 'acta.pdf' });
      const [[query]] = notificationRepo.exist.mock.calls as [
        [{ where: Record<string, unknown> }],
      ];
      expect(query.where).toMatchObject({
        entityId: 'ann-1',
        recipientUserId: 'u1',
      });
    });

    it('quien no lo recibió ve lo mismo que si no existiera', async () => {
      const { service, announcementRepo } = setup();
      announcementRepo.findOne.mockResolvedValue(announcement);

      await expect(
        service.resolveAttachment('ann-1', 0, resident),
      ).rejects.toMatchObject({ errorCode: GeneralErrorCode.NOT_FOUND });
      await expect(
        service.resolveAttachment('ann-1', 3, superAdmin),
      ).rejects.toMatchObject({ errorCode: GeneralErrorCode.NOT_FOUND });
    });
  });

  describe('decodeFileName', () => {
    it('recupera tildes y eñes que multer entrega como latin1', () => {
      const asMulter = Buffer.from('Acta reunión año.pdf', 'utf8').toString(
        'latin1',
      );
      expect(decodeFileName(asMulter)).toBe('Acta reunión año.pdf');
      expect(decodeFileName('simple.pdf')).toBe('simple.pdf');
    });
  });
});
