import { MarketplaceChatService } from './marketplace-chat.service';
import { MarketplaceConversation } from '../entities/marketplace-conversation.entity';
import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import { MarketplacePriceType } from '../enums/marketplace-price-type.enum';
import { MarketplaceMessageKind } from '../enums/marketplace-message-kind.enum';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { User } from '../../users/entities/user.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';

/**
 * Lo que el chat entre vecinos tiene que sostener:
 *
 *   1. Solo los dos participantes lo leen. Ni la administración.
 *   2. El teléfono no viaja salvo que su dueño lo comparta, y solo si el
 *      conjunto permite el contacto por teléfono.
 *   3. Con el aviso cerrado se lee pero no se escribe.
 *   4. Un bloqueo corta en las dos direcciones.
 *   5. El primer "me interesa" avisa una vez (con el id del chat), no dos.
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

const OWNER = userOf('owner-1');
const BUYER = userOf('buyer-1');

const listingOf = (partial: Partial<MarketplaceListing> = {}) =>
  ({
    id: 'listing-1',
    title: 'Bicicleta',
    type: MarketplaceListingType.PRODUCT,
    status: MarketplaceListingStatus.PUBLISHED,
    priceType: MarketplacePriceType.FIXED,
    priceAmount: 300000,
    imageUrls: [],
    ownerUserId: 'owner-1',
    unitId: 'unit-owner',
    complexId: 'complex-1',
    ...partial,
  }) as MarketplaceListing;

const conversationOf = (partial: Partial<MarketplaceConversation> = {}) =>
  ({
    id: 'conv-1',
    listingId: 'listing-1',
    complexId: 'complex-1',
    ownerUserId: 'owner-1',
    interestedUserId: 'buyer-1',
    interestedUnitId: 'unit-buyer',
    ownerUnreadCount: 0,
    interestedUnreadCount: 0,
    ...partial,
  }) as MarketplaceConversation;

const qbChain = () => {
  const chain: Record<string, jest.Mock> = {};
  for (const m of [
    'insert',
    'into',
    'values',
    'orIgnore',
    'update',
    'set',
    'where',
    'andWhere',
  ]) {
    chain[m] = jest.fn(() => chain);
  }
  chain.execute = jest.fn(() => Promise.resolve({}));
  return chain;
};

const buildHarness = (
  options: {
    conversation?: MarketplaceConversation | null;
    listing?: MarketplaceListing;
    blocked?: boolean;
    recentMessages?: number;
    allowPhoneContact?: boolean;
  } = {},
) => {
  const conversation =
    options.conversation === undefined
      ? conversationOf()
      : options.conversation;
  const listing = options.listing ?? listingOf();

  const updateChain = qbChain();
  // Sin conversación previa, la primera búsqueda no la encuentra y las
  // siguientes leen la que acaba de crear "me interesa".
  const findOne = jest.fn(() =>
    Promise.resolve(conversation ?? conversationOf()),
  );
  if (conversation === null) findOne.mockResolvedValueOnce(null);

  const conversationRepo = {
    findOne,
    findOneOrFail: jest.fn(() => Promise.resolve(conversationOf())),
    update: jest.fn(() => Promise.resolve({})),
    createQueryBuilder: jest.fn(() => updateChain),
  };

  const messageRepo = {
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn((data: Record<string, unknown>) =>
      Promise.resolve({ id: 'msg-1', createdAt: new Date(), ...data }),
    ),
    count: jest.fn(() => Promise.resolve(options.recentMessages ?? 0)),
    find: jest.fn(() => Promise.resolve([])),
  };

  const blockRepo = {
    count: jest.fn(() => Promise.resolve(options.blocked ? 1 : 0)),
    find: jest.fn(() => Promise.resolve([])),
    delete: jest.fn(() => Promise.resolve({})),
    createQueryBuilder: jest.fn(() => qbChain()),
  };

  const contactRepo = {
    findOne: jest.fn(() => Promise.resolve({ interestedUnitId: 'unit-buyer' })),
  };

  const listingsService = {
    findById: jest.fn(() => Promise.resolve(listing)),
    findByIdInternal: jest.fn(() => Promise.resolve(listing)),
    registerInterest: jest.fn(() => Promise.resolve(listing)),
    notifyInterest: jest.fn(() => Promise.resolve()),
  };

  const settingsService = {
    getOrCreate: jest.fn(() =>
      Promise.resolve({ allowPhoneContact: options.allowPhoneContact ?? true }),
    ),
  };

  const notificationsService = {
    dispatchPushOnly: jest.fn(() => Promise.resolve()),
  };
  const socketService = { emitToUsers: jest.fn(), emitToUser: jest.fn() };

  const repos = new Map<unknown, Record<string, jest.Mock>>([
    [
      User,
      {
        findOne: jest.fn(() =>
          Promise.resolve({
            id: 'owner-1',
            name: 'Ana',
            lastName: 'Ruiz',
            phoneNumber: '3001234567',
            countryCode: { dialCode: '+57' },
          }),
        ),
        find: jest.fn(() => Promise.resolve([])),
      },
    ],
    [MarketplaceListing, { find: jest.fn(() => Promise.resolve([listing])) }],
    [Unit, { find: jest.fn(() => Promise.resolve([])) }],
  ]);

  const service = new MarketplaceChatService(
    conversationRepo as never,
    messageRepo as never,
    blockRepo as never,
    contactRepo as never,
    listingsService as never,
    settingsService as never,
    notificationsService as never,
    socketService as never,
    { getRepository: (entity: unknown) => repos.get(entity) } as never,
  );

  return {
    service,
    conversationRepo,
    messageRepo,
    listingsService,
    notificationsService,
    socketService,
    updateChain,
  };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('MarketplaceChatService — quién lee', () => {
  it('un tercero no abre la conversación', async () => {
    const { service } = buildHarness();

    await expect(
      service.findMessages('conv-1', undefined, 30, userOf('otro-vecino')),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.CONVERSATION_ACCESS_DENIED,
    });
  });

  it('la administración tampoco: es privada entre los dos vecinos', async () => {
    const { service } = buildHarness();

    await expect(
      service.findMessages(
        'conv-1',
        undefined,
        30,
        userOf('admin-1', [ValidRoles.COMPLEX_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.CONVERSATION_ACCESS_DENIED,
    });
  });
});

describe('MarketplaceChatService — escribir', () => {
  it('el mensaje llega por socket a los dos y por push solo al otro', async () => {
    const { service, socketService, notificationsService } = buildHarness();

    const message = await service.send('conv-1', ' ¿Sigue disponible? ', BUYER);
    await flush();

    expect(message.body).toBe('¿Sigue disponible?');
    expect(message.isMine).toBe(true);
    expect(socketService.emitToUsers).toHaveBeenCalledWith(
      ['owner-1', 'buyer-1'],
      SocketEvent.MARKETPLACE_CHAT_MESSAGE,
      expect.objectContaining({ conversationId: 'conv-1' }),
    );
    expect(notificationsService.dispatchPushOnly).toHaveBeenCalledWith(
      ['owner-1'],
      expect.objectContaining({
        type: NotificationType.MARKETPLACE_CHAT_MESSAGE,
        androidTag: 'chat-conv-1',
      }),
    );
  });

  it('con el aviso vendido se lee pero no se escribe', async () => {
    const { service } = buildHarness({
      listing: listingOf({ status: MarketplaceListingStatus.SOLD }),
    });

    await expect(service.send('conv-1', 'hola', BUYER)).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.CONVERSATION_READ_ONLY,
    });
  });

  it('un bloqueo corta los mensajes', async () => {
    const { service } = buildHarness({ blocked: true });

    await expect(service.send('conv-1', 'hola', BUYER)).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.CONVERSATION_BLOCKED,
    });
  });

  it('frena a quien manda demasiados mensajes seguidos', async () => {
    const { service } = buildHarness({ recentMessages: 20 });

    await expect(service.send('conv-1', 'hola', BUYER)).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.MESSAGE_RATE_LIMITED,
    });
  });

  it('un mensaje vacío no se manda', async () => {
    const { service } = buildHarness();

    await expect(service.send('conv-1', '   ', BUYER)).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.MESSAGE_EMPTY,
    });
  });
});

describe('MarketplaceChatService — teléfono', () => {
  it('compartir mi WhatsApp manda el número con indicativo, como mensaje', async () => {
    const { service, conversationRepo } = buildHarness();

    const message = await service.sharePhone('conv-1', OWNER);

    expect(message.kind).toBe(MarketplaceMessageKind.PHONE_SHARED);
    expect(message.body).toBe('+573001234567');
    expect(conversationRepo.update).toHaveBeenCalledWith(
      { id: 'conv-1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ ownerPhoneSharedAt: expect.any(Date) }),
    );
  });

  it('si el conjunto apagó el contacto por teléfono, no se comparte', async () => {
    const { service } = buildHarness({ allowPhoneContact: false });

    await expect(service.sharePhone('conv-1', OWNER)).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.PHONE_SHARING_DISABLED,
    });
  });
});

describe('MarketplaceChatService — me interesa', () => {
  it('el primero abre el chat y avisa una sola vez, con el id del chat', async () => {
    const { service, listingsService, notificationsService } = buildHarness({
      conversation: null,
    });

    await service.openFromInterest('listing-1', '¿La tienes aún?', BUYER);
    await flush();

    expect(listingsService.registerInterest).toHaveBeenCalledWith(
      expect.anything(),
      BUYER,
      { notify: false },
    );
    expect(listingsService.notifyInterest).toHaveBeenCalledWith(
      expect.anything(),
      '¿La tienes aún?',
      BUYER,
      'conv-1',
    );
    // El mensaje queda en el chat, pero no genera un segundo push.
    expect(notificationsService.dispatchPushOnly).not.toHaveBeenCalled();
  });

  it('reabrir con un mensaje nuevo lo manda como mensaje del chat', async () => {
    const { service, listingsService, notificationsService } = buildHarness();

    await service.openFromInterest('listing-1', 'Te escribo de nuevo', BUYER);
    await flush();

    expect(listingsService.notifyInterest).not.toHaveBeenCalled();
    expect(notificationsService.dispatchPushOnly).toHaveBeenCalledWith(
      ['owner-1'],
      expect.anything(),
    );
  });

  it('a quien lo bloquearon no puede reabrir el canal con "me interesa"', async () => {
    const { service, listingsService } = buildHarness({ blocked: true });

    await expect(
      service.openFromInterest('listing-1', undefined, BUYER),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.CONVERSATION_BLOCKED,
    });
    expect(listingsService.registerInterest).not.toHaveBeenCalled();
  });
});
