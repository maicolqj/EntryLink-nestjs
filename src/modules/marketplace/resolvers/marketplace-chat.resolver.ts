import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { MarketplaceChatService } from '../services/marketplace-chat.service';
import { MarketplaceMessage } from '../entities/marketplace-message.entity';
import {
  MarketplaceConversationView,
  MarketplaceMessagesPage,
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

/**
 * Chat entre quien publicó y quien se interesó. Cada operación valida que
 * quien consulta participe en la conversación; la administración no lee chats.
 */
@RequireModule([ComplexModule.CLASIFICADOS, ComplexModule.SERVICIOS])
@Resolver()
export class MarketplaceChatResolver {
  constructor(private readonly chatService: MarketplaceChatService) {}

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
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedConversationsResponse> {
    return this.chatService.findMine(
      complexId,
      pagination ?? { page: 1, limit: 20 },
      currentUser,
      listingId,
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
