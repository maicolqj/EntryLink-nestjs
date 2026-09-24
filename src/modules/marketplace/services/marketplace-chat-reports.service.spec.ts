import { MarketplaceChatReportsService } from './marketplace-chat-reports.service';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';
import {
  MarketplaceChatReportAction,
  MarketplaceChatReportReason,
} from '../enums/marketplace-chat-report-reason.enum';
import { MarketplaceMessageKind } from '../enums/marketplace-message-kind.enum';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { NotificationType } from '../../notifications/enums/notification-type.enum';

/**
 * Reportar un chat es la única puerta por la que la administración lo lee:
 *
 *   1. Un reporte pendiente por persona y conversación.
 *   2. "Reportar y bloquear" deja el bloqueo hecho.
 *   3. Aceptar cierra la conversación para los dos; desestimar no la toca.
 *   4. Resolver toma todos los reportes pendientes del mismo chat.
 *   5. Los mensajes que lee la administración tampoco llevan la llave de R2.
 */

const userOf = (sub: string, roles = [ValidRoles.RESIDENT_ROL]) =>
  ({
    sub,
    email: `${sub}@test.com`,
    type: 'access',
    entityType: 'user',
    tokenVersion: 1,
    sessionId: 's1',
    roles,
    permissions: [],
    complexId: 'complex-1',
  }) as JwtAccessPayload;

const BUYER = userOf('buyer-1');
const ADMIN = userOf('admin-1', [ValidRoles.COMPLEX_ROL]);

const conversation = {
  id: 'conv-1',
  listingId: 'listing-1',
  complexId: 'complex-1',
  ownerUserId: 'owner-1',
  interestedUserId: 'buyer-1',
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const buildHarness = (
  options: { pending?: number; status?: MarketplaceReportStatus } = {},
) => {
  const report = {
    id: 'report-1',
    conversationId: 'conv-1',
    complexId: 'complex-1',
    reporterUserId: 'buyer-1',
    reportedUserId: 'owner-1',
    reason: MarketplaceChatReportReason.HARASSMENT,
    status: options.status ?? MarketplaceReportStatus.PENDING,
    createdAt: new Date(),
  };

  const reportRepo = {
    count: jest.fn(() => Promise.resolve(options.pending ?? 0)),
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn((data: Record<string, unknown>) =>
      Promise.resolve({ id: 'report-1', ...data }),
    ),
    findOne: jest.fn(() => Promise.resolve(report)),
    find: jest.fn(() => Promise.resolve([report])),
    update: jest.fn(() => Promise.resolve({})),
  };

  const conversationRepo = {
    update: jest.fn(() => Promise.resolve({})),
    find: jest.fn(() => Promise.resolve([conversation])),
  };

  const messageRepo = {
    find: jest.fn(() =>
      Promise.resolve([
        {
          id: 'm1',
          conversationId: 'conv-1',
          senderUserId: 'owner-1',
          kind: MarketplaceMessageKind.IMAGE,
          body: 'llave/secreta.jpg',
          createdAt: new Date(),
        },
      ]),
    ),
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, jest.Mock> = {};
      for (const m of ['select', 'addSelect', 'where', 'groupBy']) {
        qb[m] = jest.fn(() => qb);
      }
      qb.getRawMany = jest.fn(() => Promise.resolve([]));
      return qb;
    }),
  };

  const chatService = {
    findParticipantOrFail: jest.fn(() => Promise.resolve(conversation)),
    toPublic: jest.fn((m: { body: string; kind: MarketplaceMessageKind }) => ({
      ...m,
      body: m.kind === MarketplaceMessageKind.IMAGE ? '' : m.body,
    })),
  };

  const notificationsService = {
    findUserIdsByRoles: jest.fn(() => Promise.resolve(['admin-1'])),
    notify: jest.fn(() => Promise.resolve([])),
  };

  const complexService = {
    assertComplexAccess: jest.fn(() => Promise.resolve(undefined)),
  };

  const blockInsert: Record<string, jest.Mock> = {};
  for (const m of ['insert', 'into', 'values', 'orIgnore']) {
    blockInsert[m] = jest.fn(() => blockInsert);
  }
  blockInsert.execute = jest.fn(() => Promise.resolve({}));

  const dataSource = {
    getRepository: jest.fn(() => ({
      find: jest.fn(() => Promise.resolve([])),
      createQueryBuilder: jest.fn(() => blockInsert),
    })),
  };

  const service = new MarketplaceChatReportsService(
    reportRepo as never,
    conversationRepo as never,
    messageRepo as never,
    chatService as never,
    notificationsService as never,
    complexService as never,
    dataSource as never,
  );

  return {
    service,
    reportRepo,
    conversationRepo,
    notificationsService,
    blockInsert,
  };
};

describe('MarketplaceChatReportsService — reportar', () => {
  it('reporta al otro participante y avisa a la administración', async () => {
    const { service, reportRepo, notificationsService } = buildHarness();

    await service.report(
      { conversationId: 'conv-1', reason: MarketplaceChatReportReason.SCAM },
      BUYER,
    );
    await flush();

    expect(reportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterUserId: 'buyer-1',
        reportedUserId: 'owner-1',
      }),
    );
    expect(notificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.MARKETPLACE_CHAT_REPORTED,
        userIds: ['admin-1'],
      }),
    );
  });

  it('no deja dos reportes pendientes de la misma persona', async () => {
    const { service } = buildHarness({ pending: 1 });

    await expect(
      service.report(
        { conversationId: 'conv-1', reason: MarketplaceChatReportReason.SPAM },
        BUYER,
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.CONVERSATION_ALREADY_REPORTED,
    });
  });

  it('"reportar y bloquear" deja el bloqueo hecho', async () => {
    const { service, blockInsert } = buildHarness();

    await service.report(
      {
        conversationId: 'conv-1',
        reason: MarketplaceChatReportReason.HARASSMENT,
        alsoBlock: true,
      },
      BUYER,
    );

    expect(blockInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        blockerUserId: 'buyer-1',
        blockedUserId: 'owner-1',
      }),
    );
  });
});

describe('MarketplaceChatReportsService — resolver', () => {
  it('aceptar cierra la conversación y resuelve todos los pendientes del chat', async () => {
    const { service, reportRepo, conversationRepo } = buildHarness();

    await service.resolve(
      {
        reportId: 'report-1',
        action: MarketplaceChatReportAction.CLOSE_CONVERSATION,
      },
      ADMIN,
    );

    expect(reportRepo.update).toHaveBeenCalledWith(
      { conversationId: 'conv-1', status: MarketplaceReportStatus.PENDING },
      expect.objectContaining({ status: MarketplaceReportStatus.ACCEPTED }),
    );
    expect(conversationRepo.update).toHaveBeenCalledWith(
      { id: 'conv-1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ moderationClosedAt: expect.any(Date) }),
    );
  });

  it('desestimar deja la conversación abierta', async () => {
    const { service, conversationRepo } = buildHarness();

    await service.resolve(
      { reportId: 'report-1', action: MarketplaceChatReportAction.DISMISS },
      ADMIN,
    );

    expect(conversationRepo.update).not.toHaveBeenCalled();
  });

  it('un reporte ya resuelto no se vuelve a resolver', async () => {
    const { service } = buildHarness({
      status: MarketplaceReportStatus.DISMISSED,
    });

    await expect(
      service.resolve(
        { reportId: 'report-1', action: MarketplaceChatReportAction.DISMISS },
        ADMIN,
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.CONVERSATION_REPORT_ALREADY_RESOLVED,
    });
  });

  it('los mensajes que lee la administración no llevan la llave de R2', async () => {
    const { service } = buildHarness();

    const page = await service.findMessages('report-1', undefined, 50, ADMIN);

    expect(page.items[0].body).toBe('');
  });
});
