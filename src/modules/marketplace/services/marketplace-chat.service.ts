import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  In,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';

import { MarketplaceConversation } from '../entities/marketplace-conversation.entity';
import { MarketplaceMessage } from '../entities/marketplace-message.entity';
import { MarketplaceUserBlock } from '../entities/marketplace-user-block.entity';
import { MarketplaceConversationReport } from '../entities/marketplace-conversation-report.entity';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';
import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceListingContact } from '../entities/marketplace-listing-contact.entity';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplaceMessageKind } from '../enums/marketplace-message-kind.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import {
  ConversationRole,
  MarketplaceConversationView,
  MarketplaceMessagesPage,
  PaginatedConversationsResponse,
} from '../dto/responses/marketplace-conversation.response';
import { listingPriceLabel } from '../utils/marketplace-price.util';

import { MarketplaceListingsService } from './marketplace-listings.service';
import { MarketplaceSettingsService } from './marketplace-settings.service';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { User } from '../../users/entities/user.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';

/** Ruta del API que sirve una foto del chat. Nunca la llave de R2. */
export const imagePathFor = (message: {
  conversationId: string;
  id: string;
}): string =>
  `/api/v1/marketplace/conversations/${message.conversationId}/messages/${message.id}/image`;

/** Aviso cerrado: el chat se lee pero ya no se escribe. */
const CLOSED_STATUSES = [
  MarketplaceListingStatus.SOLD,
  MarketplaceListingStatus.EXPIRED,
  MarketplaceListingStatus.REMOVED,
];

/** Pasado este tiempo desde el último mensaje, un chat cerrado sale de la bandeja. */
const ARCHIVE_AFTER_DAYS = 90;

const MAX_BODY = 2000;
const PREVIEW_LENGTH = 200;

/** Tope contra el spam: mensajes por minuto de una misma persona. */
const MAX_MESSAGES_PER_MINUTE = 20;

const MESSAGES_PAGE = 30;

/**
 * Chat entre quien publicó un aviso y quien se interesó.
 *
 * Reglas:
 *
 *   1. Solo los dos participantes leen la conversación. La administración no:
 *      es una conversación privada entre vecinos.
 *   2. Nadie ve el teléfono del otro. El número solo viaja como mensaje
 *      `PHONE_SHARED`, cuando su dueño decide compartirlo con ESTA persona, y
 *      solo si el conjunto permite el contacto por teléfono.
 *   3. Con el aviso cerrado, vencido o retirado, el chat queda de solo lectura.
 *   4. Bloquear corta en las dos direcciones, y a quien bloquearon no se le
 *      dice: solo ve que no puede escribir.
 */
@Injectable()
export class MarketplaceChatService {
  private readonly logger = new Logger(MarketplaceChatService.name);

  constructor(
    @InjectRepository(MarketplaceConversation)
    private readonly conversationRepo: Repository<MarketplaceConversation>,
    @InjectRepository(MarketplaceMessage)
    private readonly messageRepo: Repository<MarketplaceMessage>,
    @InjectRepository(MarketplaceUserBlock)
    private readonly blockRepo: Repository<MarketplaceUserBlock>,
    @InjectRepository(MarketplaceListingContact)
    private readonly contactRepo: Repository<MarketplaceListingContact>,
    @InjectRepository(MarketplaceConversationReport)
    private readonly reportRepo: Repository<MarketplaceConversationReport>,
    private readonly listingsService: MarketplaceListingsService,
    private readonly settingsService: MarketplaceSettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly socketService: SocketService,
    private readonly dataSource: DataSource,
    private readonly complexService: ResidentialComplexService,
  ) {}

  // ================================================================
  // ABRIR
  // ================================================================

  /**
   * "Me interesa": registra el interés y abre la conversación con quien
   * publicó. Si ya existía, la reabre. El mensaje, si lo hay, queda como el
   * primero del chat.
   */
  async openFromInterest(
    listingId: string,
    message: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    const found = await this.listingsService.findById(listingId, currentUser);

    // Antes de registrar nada: un vecino bloqueado no puede reabrir el canal
    // tocando "me interesa" otra vez.
    await this.assertNotBlocked(found.ownerUserId, currentUser.sub);

    const listing = await this.listingsService.registerInterest(
      { listingId, message },
      currentUser,
      { notify: false },
    );

    const text = message?.trim() || null;
    let conversation = await this.conversationRepo.findOne({
      where: { listingId, interestedUserId: currentUser.sub },
    });
    const isNew = !conversation;

    if (!conversation) {
      const contact = await this.contactRepo.findOne({
        where: { listingId, interestedUserId: currentUser.sub },
      });

      const now = new Date();
      await this.conversationRepo
        .createQueryBuilder()
        .insert()
        .into(MarketplaceConversation)
        .values({
          listingId,
          complexId: listing.complexId,
          ownerUserId: listing.ownerUserId,
          interestedUserId: currentUser.sub,
          interestedUnitId: contact?.interestedUnitId ?? null,
          lastMessageAt: now,
          lastMessagePreview: text ? null : 'Le interesa tu aviso',
          lastMessageSenderId: currentUser.sub,
          ownerUnreadCount: text ? 0 : 1,
          interestedLastReadAt: now,
        })
        // Dos toques seguidos: el índice único gana y se lee la que quedó.
        .orIgnore()
        .execute();

      conversation = await this.conversationRepo.findOneOrFail({
        where: { listingId, interestedUserId: currentUser.sub },
      });
    }

    if (text) {
      await this.appendMessage(conversation, currentUser.sub, text, {
        kind: MarketplaceMessageKind.TEXT,
        // La conversación nueva ya avisa por "me interesa", con el mensaje.
        push: !isNew,
      });
    }

    if (isNew) {
      void this.listingsService.notifyInterest(
        listing,
        text ?? undefined,
        currentUser,
        conversation.id,
      );
    }

    return this.findOne(conversation.id, currentUser);
  }

  // ================================================================
  // CONSULTAS
  // ================================================================

  /** La bandeja: mis conversaciones, la más reciente primero. */
  async findMine(
    complexId: string,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
    listingId?: string,
  ): Promise<PaginatedConversationsResponse> {
    const { page, limit } = pagination;
    const archiveBefore = new Date(
      Date.now() - ARCHIVE_AFTER_DAYS * 86_400_000,
    );

    // Por el NOMBRE DE LA PROPIEDAD, no la columna: con joins, TypeORM no
    // traduce `c.last_message_at` al paginar.
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .innerJoin('c.listing', 'l')
      .where('c.complexId = :complexId', { complexId })
      .andWhere(
        new Brackets((w) =>
          w
            .where('c.ownerUserId = :me', { me: currentUser.sub })
            .orWhere('c.interestedUserId = :me', { me: currentUser.sub }),
        ),
      )
      .andWhere(
        new Brackets((w) =>
          w
            .where('l.status NOT IN (:...closed)', { closed: CLOSED_STATUSES })
            .orWhere('c.lastMessageAt >= :archiveBefore', { archiveBefore }),
        ),
      );

    if (listingId) qb.andWhere('c.listingId = :listingId', { listingId });

    qb.orderBy('c.lastMessageAt', 'DESC', 'NULLS LAST')
      .addOrderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, totalItems] = await qb.getManyAndCount();
    const items = await this.toViews(rows, currentUser);
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );
    const [view] = await this.toViews([conversation], currentUser);
    return view;
  }

  /** La conversación de quien consulta sobre un aviso, si ya existe. */
  async findForListing(
    listingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView | null> {
    const conversation = await this.conversationRepo.findOne({
      where: { listingId, interestedUserId: currentUser.sub },
    });
    if (!conversation) return null;
    const [view] = await this.toViews([conversation], currentUser);
    return view;
  }

  /** Mensajes sin leer en todas mis conversaciones: el número del ícono. */
  async unreadTotal(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<number> {
    const row = await this.conversationRepo
      .createQueryBuilder('c')
      .select(
        `COALESCE(SUM(CASE WHEN c.ownerUserId = :me THEN c.ownerUnreadCount ELSE c.interestedUnreadCount END), 0)`,
        'total',
      )
      .where('c.complexId = :complexId', { complexId })
      .andWhere(
        new Brackets((w) =>
          w
            .where('c.ownerUserId = :me', { me: currentUser.sub })
            .orWhere('c.interestedUserId = :me', { me: currentUser.sub }),
        ),
      )
      .getRawOne<{ total: string }>();

    return Number(row?.total ?? 0);
  }

  /**
   * Mensajes, del más nuevo al más viejo. `before` es el cursor: la fecha del
   * mensaje más viejo que ya tiene la pantalla.
   */
  async findMessages(
    conversationId: string,
    before: Date | undefined,
    limit: number | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessagesPage> {
    await this.findParticipantConversation(conversationId, currentUser);

    const take = Math.min(Math.max(limit ?? MESSAGES_PAGE, 1), 100);

    const rows = await this.messageRepo.find({
      where: {
        conversationId,
        ...(before ? { createdAt: LessThan(before) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const items = rows
      .slice(0, take)
      .map((m) => this.withIsMine(m, currentUser));

    return { items, hasMore };
  }

  // ================================================================
  // ESCRIBIR
  // ================================================================

  async send(
    conversationId: string,
    body: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessage> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );

    const text = body?.trim() ?? '';
    if (!text) {
      throw new CustomError({
        message: 'El mensaje está vacío',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.MESSAGE_EMPTY,
      });
    }

    await this.assertWritable(conversation, currentUser);

    const message = await this.appendMessage(
      conversation,
      currentUser.sub,
      text.slice(0, MAX_BODY),
      { kind: MarketplaceMessageKind.TEXT, push: true },
    );

    return this.withIsMine(message, currentUser);
  }

  /**
   * Comparte mi WhatsApp con el otro vecino. Es la única forma en que un
   * número viaja por el chat, y va como mensaje para que quede claro quién lo
   * compartió y cuándo.
   */
  async sharePhone(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessage> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );
    await this.assertWritable(conversation, currentUser);

    const settings = await this.settingsService.getOrCreate(
      conversation.complexId,
    );
    if (!settings.allowPhoneContact) {
      throw new CustomError({
        message: 'Este conjunto no permite compartir el teléfono por aquí',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MarketplaceErrorCode.PHONE_SHARING_DISABLED,
      });
    }

    const me = await this.dataSource.getRepository(User).findOne({
      where: { id: currentUser.sub },
      select: { id: true, phoneNumber: true, countryCode: true },
    });

    if (!me?.phoneNumber) {
      throw new CustomError({
        message: 'Tu cuenta no tiene un teléfono registrado',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.PHONE_NOT_AVAILABLE,
      });
    }

    // `countryCode` es jsonb con la forma de `Country`, no una cadena.
    const phone = `${me.countryCode?.dialCode ?? ''}${me.phoneNumber}`;
    const isOwner = conversation.ownerUserId === currentUser.sub;

    await this.conversationRepo.update(
      { id: conversation.id },
      isOwner
        ? { ownerPhoneSharedAt: new Date() }
        : { interestedPhoneSharedAt: new Date() },
    );

    const message = await this.appendMessage(
      conversation,
      currentUser.sub,
      phone,
      {
        kind: MarketplaceMessageKind.PHONE_SHARED,
        push: true,
        preview: 'Compartió su WhatsApp',
      },
    );

    return this.withIsMine(message, currentUser);
  }

  // ================================================================
  // FOTOS
  // ================================================================

  /**
   * Valida que se pueda mandar una foto ANTES de subirla: subir primero y
   * preguntar después deja archivos huérfanos en R2. Devuelve la conversación
   * para que el controlador arme la carpeta.
   */
  async assertCanSendImage(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversation> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );
    await this.assertWritable(conversation, currentUser);
    await this.assertRate(currentUser.sub);
    return conversation;
  }

  /** Guarda la foto ya subida como mensaje. `key` es la llave en R2. */
  async sendImage(
    conversationId: string,
    key: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessage> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );

    const message = await this.appendMessage(
      conversation,
      currentUser.sub,
      key,
      {
        kind: MarketplaceMessageKind.IMAGE,
        push: true,
        preview: '📷 Foto',
      },
    );

    return this.withIsMine(message, currentUser);
  }

  /**
   * La llave en R2 de una foto del chat, si quien pide puede verla.
   *
   * Pueden los dos participantes. La administración solo si la conversación
   * tiene un reporte: es la misma puerta por la que lee los mensajes.
   */
  async resolveImageKey(
    conversationId: string,
    messageId: string,
    currentUser: JwtAccessPayload,
  ): Promise<string> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new CustomError({
        message: 'Conversación no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.CONVERSATION_NOT_FOUND,
      });
    }

    const isParticipant =
      conversation.ownerUserId === currentUser.sub ||
      conversation.interestedUserId === currentUser.sub;

    if (!isParticipant) {
      await this.assertModeratorCanRead(conversation, currentUser);
    }

    const message = await this.messageRepo.findOne({
      where: { id: messageId, conversationId },
    });

    if (!message || message.kind !== MarketplaceMessageKind.IMAGE) {
      throw new CustomError({
        message: 'Ese mensaje no es una foto',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.MESSAGE_NOT_IMAGE,
      });
    }

    return message.body;
  }

  /**
   * La administración entra a un chat solo si fue reportado, y solo en su
   * conjunto. Sin reporte, ni siquiera el SUPER_ADMIN.
   */
  async assertModeratorCanRead(
    conversation: MarketplaceConversation,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    const reported =
      this.listingsService.isModerator(currentUser) &&
      (await this.reportRepo.count({
        where: { conversationId: conversation.id },
      })) > 0;

    if (reported) {
      await this.complexService.assertComplexAccess(
        conversation.complexId,
        currentUser,
      );
      return;
    }

    throw new CustomError({
      message: 'No participas en esta conversación',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: MarketplaceErrorCode.CONVERSATION_ACCESS_DENIED,
    });
  }

  /** Marca la conversación como leída y le avisa al otro (el "visto"). */
  async markRead(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );
    const isOwner = conversation.ownerUserId === currentUser.sub;
    const readAt = new Date();

    await this.conversationRepo.update(
      { id: conversation.id },
      isOwner
        ? { ownerUnreadCount: 0, ownerLastReadAt: readAt }
        : { interestedUnreadCount: 0, interestedLastReadAt: readAt },
    );

    this.socketService.emitToUser(
      isOwner ? conversation.interestedUserId : conversation.ownerUserId,
      SocketEvent.MARKETPLACE_CHAT_READ,
      { conversationId: conversation.id, readAt },
    );

    return true;
  }

  // ================================================================
  // BLOQUEOS
  // ================================================================

  async block(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );

    await this.blockRepo
      .createQueryBuilder()
      .insert()
      .into(MarketplaceUserBlock)
      .values({
        blockerUserId: currentUser.sub,
        blockedUserId: this.counterpartId(conversation, currentUser),
        complexId: conversation.complexId,
      })
      .orIgnore()
      .execute();

    return this.findOne(conversationId, currentUser);
  }

  async unblock(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    const conversation = await this.findParticipantConversation(
      conversationId,
      currentUser,
    );

    await this.blockRepo.delete({
      blockerUserId: currentUser.sub,
      blockedUserId: this.counterpartId(conversation, currentUser),
    });

    return this.findOne(conversationId, currentUser);
  }

  // ================================================================
  // INTERNOS
  // ================================================================

  private async appendMessage(
    conversation: MarketplaceConversation,
    senderUserId: string,
    body: string,
    options: {
      kind: MarketplaceMessageKind;
      push: boolean;
      preview?: string;
    },
  ): Promise<MarketplaceMessage> {
    await this.assertRate(senderUserId);

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        senderUserId,
        kind: options.kind,
        body,
      }),
    );

    const senderIsOwner = conversation.ownerUserId === senderUserId;
    const preview = (options.preview ?? body).slice(0, PREVIEW_LENGTH);

    // Escribir cuenta como leer: quien manda queda al día, y al otro se le
    // suma uno. El incremento va en SQL para no pisar otro mensaje simultáneo.
    await this.conversationRepo
      .createQueryBuilder()
      .update(MarketplaceConversation)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview,
        lastMessageSenderId: senderUserId,
        ...(senderIsOwner
          ? {
              ownerUnreadCount: 0,
              ownerLastReadAt: message.createdAt,
              interestedUnreadCount: () => '"interested_unread_count" + 1',
            }
          : {
              interestedUnreadCount: 0,
              interestedLastReadAt: message.createdAt,
              ownerUnreadCount: () => '"owner_unread_count" + 1',
            }),
      })
      .where('id = :id', { id: conversation.id })
      .execute();

    const recipientId = senderIsOwner
      ? conversation.interestedUserId
      : conversation.ownerUserId;

    // Por el socket sale la versión pública: sin la llave de R2 de las fotos.
    this.socketService.emitToUsers(
      [conversation.ownerUserId, conversation.interestedUserId],
      SocketEvent.MARKETPLACE_CHAT_MESSAGE,
      { conversationId: conversation.id, message: this.toPublic(message) },
    );

    if (options.push) {
      void this.pushMessage(conversation, senderUserId, recipientId, preview);
    }

    return message;
  }

  /**
   * El push del mensaje. Solo push: un chat activo llenaría la bandeja de
   * notificaciones con cada "ok, gracias". Lleva la misma etiqueta por
   * conversación para que Android deje un solo aviso con el último mensaje.
   */
  private async pushMessage(
    conversation: MarketplaceConversation,
    senderUserId: string,
    recipientId: string,
    preview: string,
  ): Promise<void> {
    try {
      const [sender, listing] = await Promise.all([
        this.dataSource.getRepository(User).findOne({
          where: { id: senderUserId },
          select: { id: true, name: true, lastName: true },
        }),
        this.listingsService.findByIdInternal(conversation.listingId),
      ]);

      const name =
        `${sender?.name ?? ''} ${sender?.lastName ?? ''}`.trim() || 'Un vecino';

      await this.notificationsService.dispatchPushOnly([recipientId], {
        complexId: conversation.complexId,
        userIds: [recipientId],
        type: NotificationType.MARKETPLACE_CHAT_MESSAGE,
        priority: NotificationPriority.HIGH,
        title: listing ? `${name} · ${listing.title}` : name,
        body: preview,
        entityType: 'marketplace_conversation',
        entityId: conversation.id,
        createdByUserId: senderUserId,
        androidTag: `chat-${conversation.id}`,
        metadata: {
          conversationId: conversation.id,
          listingId: conversation.listingId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo avisar el mensaje de ${conversation.id}: ${(err as Error)?.message}`,
      );
    }
  }

  /** La conversación, si quien consulta participa en ella. */
  findParticipantOrFail(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversation> {
    return this.findParticipantConversation(conversationId, currentUser);
  }

  private async findParticipantConversation(
    conversationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new CustomError({
        message: 'Conversación no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.CONVERSATION_NOT_FOUND,
      });
    }

    // Ni la administración entra: es una conversación privada entre vecinos.
    if (
      conversation.ownerUserId !== currentUser.sub &&
      conversation.interestedUserId !== currentUser.sub
    ) {
      throw new CustomError({
        message: 'No participas en esta conversación',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MarketplaceErrorCode.CONVERSATION_ACCESS_DENIED,
      });
    }

    return conversation;
  }

  private async assertWritable(
    conversation: MarketplaceConversation,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    if (conversation.moderationClosedAt) {
      throw new CustomError({
        message: 'La administración cerró esta conversación',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.CONVERSATION_CLOSED_BY_MODERATION,
      });
    }

    const listing = await this.listingsService.findByIdInternal(
      conversation.listingId,
    );

    if (
      !listing ||
      listing.deletedAt ||
      CLOSED_STATUSES.includes(listing.status)
    ) {
      throw new CustomError({
        message:
          'El aviso ya se cerró: la conversación queda solo para consulta',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.CONVERSATION_READ_ONLY,
      });
    }

    await this.assertNotBlocked(
      this.counterpartId(conversation, currentUser),
      currentUser.sub,
    );
  }

  /** Bloqueo en cualquier dirección. No se dice quién bloqueó a quién. */
  private async assertNotBlocked(
    otherUserId: string,
    me: string,
  ): Promise<void> {
    const blocked = await this.blockRepo.count({
      where: [
        { blockerUserId: me, blockedUserId: otherUserId },
        { blockerUserId: otherUserId, blockedUserId: me },
      ],
    });

    if (blocked > 0) {
      throw new CustomError({
        message: 'No es posible escribirle a este vecino',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MarketplaceErrorCode.CONVERSATION_BLOCKED,
      });
    }
  }

  private async assertRate(senderUserId: string): Promise<void> {
    const recent = await this.messageRepo.count({
      where: {
        senderUserId,
        createdAt: MoreThan(new Date(Date.now() - 60_000)),
      },
    });

    if (recent >= MAX_MESSAGES_PER_MINUTE) {
      throw new CustomError({
        message:
          'Vas muy rápido. Espera un momento antes de seguir escribiendo',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: MarketplaceErrorCode.MESSAGE_RATE_LIMITED,
      });
    }
  }

  private counterpartId(
    conversation: MarketplaceConversation,
    currentUser: JwtAccessPayload,
  ): string {
    return conversation.ownerUserId === currentUser.sub
      ? conversation.interestedUserId
      : conversation.ownerUserId;
  }

  private withIsMine(
    message: MarketplaceMessage,
    currentUser: JwtAccessPayload,
  ): MarketplaceMessage {
    return this.toPublic(message, currentUser.sub);
  }

  /**
   * El mensaje tal como puede salir del servidor. En una foto, `body` guarda la
   * llave del archivo en R2: se vacía y en su lugar va `imagePath`, la ruta del
   * API que la sirve después de validar quién la pide.
   */
  toPublic(message: MarketplaceMessage, viewerId?: string): MarketplaceMessage {
    const copy = Object.assign(new MarketplaceMessage(), message);
    copy.isMine = viewerId ? message.senderUserId === viewerId : false;

    if (message.kind === MarketplaceMessageKind.IMAGE) {
      copy.body = '';
      copy.imagePath = imagePathFor(message);
    }

    return copy;
  }

  /**
   * Arma las vistas por lote: una consulta por avisos, otra por usuarios, otra
   * por unidades y otra por bloqueos, sin importar cuántas conversaciones haya
   * en la página.
   */
  private async toViews(
    conversations: MarketplaceConversation[],
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView[]> {
    if (conversations.length === 0) return [];

    const me = currentUser.sub;
    const listingIds = [...new Set(conversations.map((c) => c.listingId))];
    const counterpartIds = [
      ...new Set(conversations.map((c) => this.counterpartId(c, currentUser))),
    ];

    const [listings, users, blocks] = await Promise.all([
      this.dataSource.getRepository(MarketplaceListing).find({
        where: { id: In(listingIds) },
        withDeleted: true,
      }),
      this.dataSource.getRepository(User).find({
        where: { id: In(counterpartIds) },
        select: { id: true, name: true, lastName: true, profilePicture: true },
      }),
      this.blockRepo.find({
        where: [
          { blockerUserId: me, blockedUserId: In(counterpartIds) },
          { blockerUserId: In(counterpartIds), blockedUserId: me },
        ],
      }),
    ]);

    const listingById = new Map(listings.map((l) => [l.id, l]));
    const userById = new Map(users.map((u) => [u.id, u]));

    const myPendingReports = await this.reportRepo.find({
      where: {
        conversationId: In(conversations.map((c) => c.id)),
        reporterUserId: me,
        status: MarketplaceReportStatus.PENDING,
      },
      select: { id: true, conversationId: true },
    });
    const reportedIds = new Set(myPendingReports.map((r) => r.conversationId));

    // La unidad del otro: la del aviso si el otro publicó, la guardada al
    // preguntar si el otro es el interesado.
    const unitIds = [
      ...new Set(
        conversations
          .map((c) =>
            c.ownerUserId === me
              ? c.interestedUnitId
              : listingById.get(c.listingId)?.unitId,
          )
          .filter((id): id is string => !!id),
      ),
    ];
    const units = unitIds.length
      ? await this.dataSource.getRepository(Unit).find({
          where: { id: In(unitIds) },
          relations: ['building'],
        })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));

    const settingsByComplex = new Map<string, boolean>();
    for (const complexId of new Set(conversations.map((c) => c.complexId))) {
      const settings = await this.settingsService.getOrCreate(complexId);
      settingsByComplex.set(complexId, settings.allowPhoneContact);
    }

    return conversations.map((c) => {
      const isOwner = c.ownerUserId === me;
      const otherId = isOwner ? c.interestedUserId : c.ownerUserId;
      const listing = listingById.get(c.listingId);
      const other = userById.get(otherId);
      const unit = unitById.get(
        (isOwner ? c.interestedUnitId : listing?.unitId) ?? '',
      );

      const blockedByMe = blocks.some(
        (b) => b.blockerUserId === me && b.blockedUserId === otherId,
      );
      const isBlocked =
        blockedByMe ||
        blocks.some(
          (b) => b.blockerUserId === otherId && b.blockedUserId === me,
        );

      const closedByModeration = !!c.moderationClosedAt;
      const isReadOnly =
        closedByModeration ||
        !listing ||
        !!listing.deletedAt ||
        CLOSED_STATUSES.includes(listing.status);

      return {
        id: c.id,
        role: isOwner ? ConversationRole.OWNER : ConversationRole.INTERESTED,
        listing: {
          id: c.listingId,
          title: listing?.title ?? 'Aviso retirado',
          type: listing?.type ?? MarketplaceListingType.PRODUCT,
          status: listing?.status ?? MarketplaceListingStatus.REMOVED,
          imageUrl: listing?.imageUrls?.[0] ?? null,
          priceLabel: listing ? listingPriceLabel(listing) : '',
        },
        counterpart: {
          name:
            `${other?.name ?? ''} ${other?.lastName ?? ''}`.trim() ||
            'Usuario eliminado',
          profilePicture: other?.profilePicture ?? null,
          unitLabel: unit
            ? [unit.building?.name, unit.number].filter(Boolean).join(' · ')
            : null,
        },
        lastMessagePreview: c.lastMessagePreview,
        lastMessageAt: c.lastMessageAt,
        lastMessageIsMine: c.lastMessageSenderId === me,
        unreadCount: isOwner ? c.ownerUnreadCount : c.interestedUnreadCount,
        counterpartLastReadAt: isOwner
          ? c.interestedLastReadAt
          : c.ownerLastReadAt,
        isReadOnly,
        closedByModeration,
        reportedByMe: reportedIds.has(c.id),
        isBlocked,
        blockedByMe,
        myPhoneShared: !!(isOwner
          ? c.ownerPhoneSharedAt
          : c.interestedPhoneSharedAt),
        canSharePhone: settingsByComplex.get(c.complexId) ?? false,
      };
    });
  }
}
