import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { SentMessage }                   from '../entities/sent-message.entity';
import { MessagesService }               from '../services/messages.service';
import { SaveSentMessageInput }          from '../dto/inputs/save-sent-message.input';
import { PaginatedSentMessagesResponse } from '../dto/responses/paginated-sent-messages.response';
import { PaginationInput }               from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => SentMessage)
export class MessagesResolver {

  constructor(private readonly messagesService: MessagesService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  @Mutation(() => SentMessage, { name: 'saveSentMessage' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.SEND_MESSAGE],
  })
  saveSentMessage(
    @Args('input') input: SaveSentMessageInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SentMessage> {
    return this.messagesService.saveSentMessage(input, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => PaginatedSentMessagesResponse, { name: 'sentMessages' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.VIEW_SENT_MESSAGES],
  })
  sentMessages(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedSentMessagesResponse> {
    return this.messagesService.findSentMessages(complexId, pagination, currentUser);
  }
}
