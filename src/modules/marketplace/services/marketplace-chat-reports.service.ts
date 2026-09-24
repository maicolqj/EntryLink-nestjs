import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';

import { MarketplaceConversation } from '../entities/marketplace-conversation.entity';
import { MarketplaceConversationReport } from '../entities/marketplace-conversation-report.entity';
import { MarketplaceMessage } from '../entities/marketplace-message.entity';
import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceUserBlock } from '../entities/marketplace-user-block.entity';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import {
  MarketplaceChatReportAction,
  MarketplaceChatReportReason,
} from '../enums/marketplace-chat-report-reason.enum';
import {
  ReportConversationInput,
  ResolveConversationReportInput,
} from '../dto/inputs/conversation-report.input';
import {
  ConversationReportView,
  PaginatedConversationReportsResponse,
} from '../dto/responses/conversation-report.response';
import { MarketplaceMessagesPage } from '../dto/responses/marketplace-conversation.response';
import { listingPriceLabel } from '../utils/marketplace-price.util';

import { MarketplaceChatService } from './marketplace-chat.service';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { User } from '../../users/entities/user.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';

const REASON_LABEL: Record<MarketplaceChatReportReason, string> = {
  [MarketplaceChatReportReason.HARASSMENT]: 'acoso',
  [MarketplaceChatReportReason.SCAM]: 'posible estafa',
  [MarketplaceChatReportReason.OFFENSIVE]: 'lenguaje ofensivo',
  [MarketplaceChatReportReason.SPAM]: 'mensajes repetidos',
  [MarketplaceChatReportReason.OTHER]: 'otro motivo',
};

/**
 * Reportes de conversaciones del chat de clasificados.
 *
 * El reporte es la única puerta por la que la administración lee un chat.
 * Quien reportó lo ve la administración; al reportado nunca se le dice.
 *
 * Aceptar el reporte cierra la conversación para los dos (queda de solo
 * lectura). Desestimarlo la deja como estaba.
 */
@Injectable()
export class MarketplaceChatReportsService {
  private readonly logger = new Logger(MarketplaceChatReportsService.name);

  constructor(
    @InjectRepository(MarketplaceConversationReport)
    private readonly reportRepo: Repository<MarketplaceConversationReport>,
    @InjectRepository(MarketplaceConversation)
    private readonly conversationRepo: Repository<MarketplaceConversation>,
    @InjectRepository(MarketplaceMessage)
    private readonly messageRepo: Repository<MarketplaceMessage>,
    private readonly chatService: MarketplaceChatService,
    private readonly notificationsService: NotificationsService,
    private readonly complexService: ResidentialComplexService,
    private readonly dataSource: DataSource,
  ) {}

  // ================================================================
  // RESIDENTE
  // ================================================================

  async report(
    input: ReportConversationInput,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const conversation = await this.chatService.findParticipantOrFail(
      input.conversationId,
      currentUser,
    );

    const reportedUserId =
      conversation.ownerUserId === currentUser.sub
        ? conversation.interestedUserId
        : conversation.ownerUserId;

    const pending = await this.reportRepo.count({
      where: {
        conversationId: conversation.id,
        reporterUserId: currentUser.sub,
        status: MarketplaceReportStatus.PENDING,
      },
    });

    if (pending > 0) {
      throw new CustomError({
        message: 'Ya reportaste esta conversación. La administración la revisa',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.CONVERSATION_ALREADY_REPORTED,
      });
    }

    const report = await this.reportRepo.save(
      this.reportRepo.create({
        conversationId: conversation.id,
        complexId: conversation.complexId,
        reporterUserId: currentUser.sub,
        reportedUserId,
        reason: input.reason,
        comment: input.comment?.trim() || null,
      }),
    );

    if (input.alsoBlock) {
      await this.dataSource
        .getRepository(MarketplaceUserBlock)
        .createQueryBuilder()
        .insert()
        .into(MarketplaceUserBlock)
        .values({
          blockerUserId: currentUser.sub,
          blockedUserId: reportedUserId,
          complexId: conversation.complexId,
        })
        .orIgnore()
        .execute();
    }

    void this.notifyModerators(report);

    return true;
  }

  // ================================================================
  // ADMINISTRACIÓN
  // ================================================================

  async findByComplex(
    complexId: string,
    status: MarketplaceReportStatus | undefined,
    types: MarketplaceListingType[] | undefined,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedConversationReportsResponse> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    const { page, limit } = pagination;

    const qb = this.reportRepo
      .createQueryBuilder('r')
      .innerJoin(MarketplaceConversation, 'c', 'c.id = r.conversationId')
      .innerJoin(MarketplaceListing, 'l', 'l.id = c.listingId')
      .where('r.complexId = :complexId', { complexId });

    if (status) qb.andWhere('r.status = :status', { status });
    if (types?.length) qb.andWhere('l.type IN (:...types)', { types });

    // Por el NOMBRE DE LA PROPIEDAD: con joins, TypeORM no traduce la columna.
    qb.orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, totalItems] = await qb.getManyAndCount();
    const items = await this.toViews(rows);
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
    reportId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ConversationReportView> {
    const report = await this.findReportOrFail(reportId, currentUser);
    const [view] = await this.toViews([report]);
    return view;
  }

  /** Los mensajes del chat reportado, del más nuevo al más viejo. */
  async findMessages(
    reportId: string,
    before: Date | undefined,
    limit: number | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessagesPage> {
    const report = await this.findReportOrFail(reportId, currentUser);
    const take = Math.min(Math.max(limit ?? 50, 1), 100);

    const rows = await this.messageRepo.find({
      where: {
        conversationId: report.conversationId,
        ...(before ? { createdAt: LessThan(before) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: take + 1,
    });

    return {
      items: rows.slice(0, take).map((m) => this.chatService.toPublic(m)),
      hasMore: rows.length > take,
    };
  }

  async resolve(
    input: ResolveConversationReportInput,
    currentUser: JwtAccessPayload,
  ): Promise<ConversationReportView> {
    const report = await this.findReportOrFail(input.reportId, currentUser);

    if (report.status !== MarketplaceReportStatus.PENDING) {
      throw new CustomError({
        message: 'Este reporte ya se resolvió',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.CONVERSATION_REPORT_ALREADY_RESOLVED,
      });
    }

    const accepted =
      input.action === MarketplaceChatReportAction.CLOSE_CONVERSATION;
    const now = new Date();

    // Se resuelven juntos todos los reportes pendientes del mismo chat: si los
    // dos vecinos se reportaron entre sí, es una sola decisión.
    await this.reportRepo.update(
      {
        conversationId: report.conversationId,
        status: MarketplaceReportStatus.PENDING,
      },
      {
        status: accepted
          ? MarketplaceReportStatus.ACCEPTED
          : MarketplaceReportStatus.DISMISSED,
        resolutionNote: input.note?.trim() || null,
        resolvedAt: now,
        resolvedByUserId:
          currentUser.entityType === 'user' ? currentUser.sub : null,
      },
    );

    if (accepted) {
      await this.conversationRepo.update(
        { id: report.conversationId },
        { moderationClosedAt: now },
      );
    }

    void this.notifyReporters(report.conversationId, accepted, now);

    return this.findOne(report.id, currentUser);
  }

  // ================================================================
  // INTERNOS
  // ================================================================

  private async findReportOrFail(
    reportId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationReport> {
    const report = await this.reportRepo.findOne({ where: { id: reportId } });

    if (!report) {
      throw new CustomError({
        message: 'Reporte no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.CONVERSATION_REPORT_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(
      report.complexId,
      currentUser,
    );

    return report;
  }

  private async notifyModerators(
    report: MarketplaceConversationReport,
  ): Promise<void> {
    try {
      const adminIds = await this.notificationsService.findUserIdsByRoles(
        report.complexId,
        [ValidRoles.COMPLEX_ROL],
      );
      if (adminIds.length === 0) return;

      await this.notificationsService.notify({
        complexId: report.complexId,
        userIds: adminIds,
        type: NotificationType.MARKETPLACE_CHAT_REPORTED,
        priority: NotificationPriority.NORMAL,
        title: 'Reportaron un chat de clasificados',
        body: `Un vecino reportó una conversación por ${REASON_LABEL[report.reason]}.`,
        entityType: 'marketplace_conversation_report',
        entityId: report.id,
        metadata: { reportId: report.id, reason: report.reason },
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo avisar el reporte ${report.id}: ${(err as Error)?.message}`,
      );
    }
  }

  /** A quien reportó se le dice que se revisó; no qué se hizo con el otro. */
  private async notifyReporters(
    conversationId: string,
    accepted: boolean,
    resolvedAt: Date,
  ): Promise<void> {
    try {
      const reports = await this.reportRepo.find({
        where: { conversationId, resolvedAt },
      });
      const reporterIds = [...new Set(reports.map((r) => r.reporterUserId))];
      if (reporterIds.length === 0) return;

      await this.notificationsService.notify({
        complexId: reports[0].complexId,
        userIds: reporterIds,
        type: NotificationType.MARKETPLACE_CHAT_REPORT_RESOLVED,
        priority: NotificationPriority.NORMAL,
        title: 'Revisamos tu reporte',
        body: accepted
          ? 'La administración cerró la conversación que reportaste.'
          : 'La administración revisó la conversación que reportaste y no encontró motivo para cerrarla.',
        entityType: 'marketplace_conversation',
        entityId: conversationId,
        metadata: { conversationId },
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo avisar la resolución del chat ${conversationId}: ${(err as Error)?.message}`,
      );
    }
  }

  private async toViews(
    reports: MarketplaceConversationReport[],
  ): Promise<ConversationReportView[]> {
    if (reports.length === 0) return [];

    const conversations = await this.conversationRepo.find({
      where: { id: In([...new Set(reports.map((r) => r.conversationId))]) },
    });
    const convById = new Map(conversations.map((c) => [c.id, c]));

    const listingIds = [...new Set(conversations.map((c) => c.listingId))];
    const userIds = [
      ...new Set(reports.flatMap((r) => [r.reporterUserId, r.reportedUserId])),
    ];

    const [listings, users, counts] = await Promise.all([
      this.dataSource.getRepository(MarketplaceListing).find({
        where: { id: In(listingIds) },
        withDeleted: true,
      }),
      this.dataSource.getRepository(User).find({
        where: { id: In(userIds) },
        select: { id: true, name: true, lastName: true, profilePicture: true },
      }),
      this.messageRepo
        .createQueryBuilder('m')
        .select('m.conversationId', 'conversationId')
        .addSelect('COUNT(*)', 'total')
        .where('m.conversationId IN (:...ids)', {
          ids: conversations.map((c) => c.id),
        })
        .groupBy('m.conversationId')
        .getRawMany<{ conversationId: string; total: string }>(),
    ]);

    const listingById = new Map(listings.map((l) => [l.id, l]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const countById = new Map(
      counts.map((c) => [c.conversationId, Number(c.total)]),
    );

    // La unidad de cada lado: la del aviso para quien publicó, la guardada al
    // preguntar para el interesado.
    const unitIds = [
      ...new Set(
        conversations
          .flatMap((c) => [
            listingById.get(c.listingId)?.unitId,
            c.interestedUnitId,
          ])
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

    const personOf = (userId: string, conv?: MarketplaceConversation) => {
      const user = userById.get(userId);
      const unitId =
        conv && userId === conv.ownerUserId
          ? listingById.get(conv.listingId)?.unitId
          : conv?.interestedUnitId;
      const unit = unitById.get(unitId ?? '');
      return {
        name:
          `${user?.name ?? ''} ${user?.lastName ?? ''}`.trim() ||
          'Usuario eliminado',
        profilePicture: user?.profilePicture ?? null,
        unitLabel: unit
          ? [unit.building?.name, unit.number].filter(Boolean).join(' · ')
          : null,
      };
    };

    return reports.map((r) => {
      const conv = convById.get(r.conversationId);
      const listing = conv ? listingById.get(conv.listingId) : undefined;

      return {
        id: r.id,
        conversationId: r.conversationId,
        reason: r.reason,
        comment: r.comment,
        status: r.status,
        resolutionNote: r.resolutionNote,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        listing: {
          id: listing?.id ?? conv?.listingId ?? '',
          title: listing?.title ?? 'Aviso retirado',
          type: listing?.type ?? MarketplaceListingType.PRODUCT,
          status: listing?.status ?? MarketplaceListingStatus.REMOVED,
          imageUrl: listing?.imageUrls?.[0] ?? null,
          priceLabel: listing ? listingPriceLabel(listing) : '',
        },
        reporterUserId: r.reporterUserId,
        reporter: personOf(r.reporterUserId, conv),
        reportedUserId: r.reportedUserId,
        reported: personOf(r.reportedUserId, conv),
        messagesCount: countById.get(r.conversationId) ?? 0,
        conversationClosed: !!conv?.moderationClosedAt,
      };
    });
  }
}
