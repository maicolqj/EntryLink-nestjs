import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { MarketplaceChatService } from '../services/marketplace-chat.service';
import { MarketplaceChatReportsService } from '../services/marketplace-chat-reports.service';
import {
  ConversationReportView,
  PaginatedConversationReportsResponse,
} from '../dto/responses/conversation-report.response';
import {
  ReportConversationInput,
  ResolveConversationReportInput,
} from '../dto/inputs/conversation-report.input';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import { MarketplaceMessage } from '../entities/marketplace-message.entity';
import {
  MarketplaceConversationView,
  MarketplaceMessagesPage,
  MarketplaceUnreadSummary,
  PaginatedConversationsResponse,
} from '../dto/responses/marketplace-conversation.response';
import {
  OpenListingConversationInput,
  SendMarketplaceMessageInput,
} from '../dto/inputs/marketplace-chat.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

/** Quien vive en el conjunto y usa la vitrina. */
const RESIDENT_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.RESIDENT_ROL,
  ValidRoles.COUNCIL_ROL,
];

const AUTH = {
  roles: RESIDENT_ROLES,
  permissions: [ValidPermissions.VIEW_MARKETPLACE],
};

/** Revisar chats reportados es de la administración, como los avisos reportados. */
const MODERATION_AUTH = {
  roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
  permissions: [ValidPermissions.MANAGE_LISTING_REPORTS],
};

/**
 * Chat entre quien publicó y quien se interesó. Cada operación valida que
 * quien consulta participe en la conversación; la administración no lee chats.
 */
@RequireModule([ComplexModule.CLASIFICADOS, ComplexModule.SERVICIOS])
@Resolver()
export class MarketplaceChatResolver {
  constructor(
    private readonly chatService: MarketplaceChatService,
    private readonly reportsService: MarketplaceChatReportsService,
  ) {}

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => PaginatedConversationsResponse, {
    name: 'myMarketplaceConversations',
  })
  @Auth(AUTH)
  myMarketplaceConversations(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput,
    @Args('listingId', {
      nullable: true,
      description: 'Solo las de un aviso (útil para quien lo publicó)',
    })
    listingId: string,
    @Args('types', {
      type: () => [MarketplaceListingType],
      nullable: true,
      description: 'Solo las de avisos de estos tipos (un tablero)',
    })
    types: MarketplaceListingType[] | undefined,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedConversationsResponse> {
    return this.chatService.findMine(
      complexId,
      pagination ?? { page: 1, limit: 20 },
      currentUser,
      listingId,
      types,
    );
  }

  @Query(() => MarketplaceConversationView, {
    name: 'marketplaceConversation',
  })
  @Auth(AUTH)
  marketplaceConversation(
    @Args('conversationId') conversationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    return this.chatService.findOne(conversationId, currentUser);
  }

  @Query(() => MarketplaceConversationView, {
    name: 'myListingConversation',
    nullable: true,
    description: 'Mi conversación sobre un aviso ajeno, si ya existe',
  })
  @Auth(AUTH)
  myListingConversation(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView | null> {
    return this.chatService.findForListing(listingId, currentUser);
  }

  @Query(() => MarketplaceMessagesPage, { name: 'marketplaceMessages' })
  @Auth(AUTH)
  marketplaceMessages(
    @Args('conversationId') conversationId: string,
    @Args('before', {
      type: () => Date,
      nullable: true,
      description: 'Fecha del mensaje más viejo que ya se tiene',
    })
    before: Date | undefined,
    @Args('limit', { type: () => Int, nullable: true }) limit: number,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessagesPage> {
    return this.chatService.findMessages(
      conversationId,
      before,
      limit,
      currentUser,
    );
  }

  @Query(() => MarketplaceUnreadSummary, {
    name: 'marketplaceUnreadSummary',
    description: 'Mensajes sin leer en total, de clasificados y de servicios',
  })
  @Auth(AUTH)
  marketplaceUnreadSummary(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceUnreadSummary> {
    return this.chatService.unreadSummary(complexId, currentUser);
  }

  @Query(() => Int, {
    name: 'marketplaceUnreadMessages',
    description: 'Mensajes sin leer en todas mis conversaciones',
  })
  @Auth(AUTH)
  marketplaceUnreadMessages(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<number> {
    return this.chatService.unreadTotal(complexId, currentUser);
  }

  // ================================================================
  // MUTATIONS
  // ================================================================

  @Mutation(() => MarketplaceConversationView, {
    name: 'openListingConversation',
    description: '"Me interesa": registra el interés y abre el chat',
  })
  @Auth(AUTH)
  openListingConversation(
    @Args('input') input: OpenListingConversationInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    return this.chatService.openFromInterest(
      input.listingId,
      input.message,
      currentUser,
    );
  }

  @Mutation(() => MarketplaceMessage, { name: 'sendMarketplaceMessage' })
  @Auth(AUTH)
  sendMarketplaceMessage(
    @Args('input') input: SendMarketplaceMessageInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessage> {
    return this.chatService.send(input.conversationId, input.body, currentUser);
  }

  @Mutation(() => MarketplaceMessage, {
    name: 'shareMyPhoneInConversation',
    description: 'Comparte mi WhatsApp con el otro vecino de esta conversación',
  })
  @Auth(AUTH)
  shareMyPhoneInConversation(
    @Args('conversationId') conversationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessage> {
    return this.chatService.sharePhone(conversationId, currentUser);
  }

  @Mutation(() => Boolean, { name: 'markMarketplaceConversationRead' })
  @Auth(AUTH)
  markMarketplaceConversationRead(
    @Args('conversationId') conversationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.chatService.markRead(conversationId, currentUser);
  }

  @Mutation(() => MarketplaceConversationView, {
    name: 'blockConversationCounterpart',
    description: 'Bloquea al otro vecino: ninguno puede escribirle al otro',
  })
  @Auth(AUTH)
  blockConversationCounterpart(
    @Args('conversationId') conversationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    return this.chatService.block(conversationId, currentUser);
  }

  // ================================================================
  // REPORTES
  // ================================================================

  @Mutation(() => Boolean, {
    name: 'reportMarketplaceConversation',
    description:
      'Reporta la conversación a la administración. Es lo único que le permite leerla',
  })
  @Auth(AUTH)
  reportMarketplaceConversation(
    @Args('input') input: ReportConversationInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.reportsService.report(input, currentUser);
  }

  @Query(() => PaginatedConversationReportsResponse, {
    name: 'marketplaceConversationReports',
  })
  @Auth(MODERATION_AUTH)
  marketplaceConversationReports(
    @Args('complexId') complexId: string,
    @Args('status', { type: () => MarketplaceReportStatus, nullable: true })
    status: MarketplaceReportStatus | undefined,
    @Args('types', {
      type: () => [MarketplaceListingType],
      nullable: true,
      description: 'Solo los chats de avisos de estos tipos (tablero)',
    })
    types: MarketplaceListingType[] | undefined,
    @Args('pagination', { nullable: true }) pagination: PaginationInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedConversationReportsResponse> {
    return this.reportsService.findByComplex(
      complexId,
      status,
      types,
      pagination ?? { page: 1, limit: 20 },
      currentUser,
    );
  }

  @Query(() => ConversationReportView, {
    name: 'marketplaceConversationReport',
  })
  @Auth(MODERATION_AUTH)
  marketplaceConversationReport(
    @Args('reportId') reportId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ConversationReportView> {
    return this.reportsService.findOne(reportId, currentUser);
  }

  @Query(() => MarketplaceMessagesPage, {
    name: 'marketplaceConversationReportMessages',
    description: 'Los mensajes del chat reportado, del más nuevo al más viejo',
  })
  @Auth(MODERATION_AUTH)
  marketplaceConversationReportMessages(
    @Args('reportId') reportId: string,
    @Args('before', { type: () => Date, nullable: true })
    before: Date | undefined,
    @Args('limit', { type: () => Int, nullable: true }) limit: number,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceMessagesPage> {
    return this.reportsService.findMessages(
      reportId,
      before,
      limit,
      currentUser,
    );
  }

  @Mutation(() => ConversationReportView, {
    name: 'resolveMarketplaceConversationReport',
  })
  @Auth(MODERATION_AUTH)
  resolveMarketplaceConversationReport(
    @Args('input') input: ResolveConversationReportInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ConversationReportView> {
    return this.reportsService.resolve(input, currentUser);
  }

  @Mutation(() => MarketplaceConversationView, {
    name: 'unblockConversationCounterpart',
  })
  @Auth(AUTH)
  unblockConversationCounterpart(
    @Args('conversationId') conversationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceConversationView> {
    return this.chatService.unblock(conversationId, currentUser);
  }
}
