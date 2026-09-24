import { ObjectType, Field, Int } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { MarketplaceChatReportReason } from '../../enums/marketplace-chat-report-reason.enum';
import { MarketplaceReportStatus } from '../../enums/marketplace-report-status.enum';
import {
  ConversationCounterpart,
  ConversationListingSummary,
} from './marketplace-conversation.response';

/**
 * Un chat reportado, como lo lee la administración. Aquí sí van los dos
 * nombres: moderar exige saber quién dijo qué. Al reportado nunca se le dice
 * quién lo reportó.
 */
@ObjectType({ description: 'Conversación reportada, para moderación' })
export class ConversationReportView {
  @Field(() => String)
  id: string;

  @Field(() => String)
  conversationId: string;

  @Field(() => MarketplaceChatReportReason)
  reason: MarketplaceChatReportReason;

  @Field(() => String, { nullable: true })
  comment?: string | null;

  @Field(() => MarketplaceReportStatus)
  status: MarketplaceReportStatus;

  @Field(() => String, { nullable: true })
  resolutionNote?: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  resolvedAt?: Date | null;

  @Field(() => ConversationListingSummary)
  listing: ConversationListingSummary;

  @Field(() => String, { description: 'Para marcar sus mensajes' })
  reporterUserId: string;

  @Field(() => ConversationCounterpart)
  reporter: ConversationCounterpart;

  @Field(() => String, { description: 'Para marcar sus mensajes' })
  reportedUserId: string;

  @Field(() => ConversationCounterpart)
  reported: ConversationCounterpart;

  @Field(() => Int)
  messagesCount: number;

  @Field(() => Boolean, { description: 'La conversación ya está cerrada' })
  conversationClosed: boolean;
}

@ObjectType()
export class PaginatedConversationReportsResponse {
  @Field(() => [ConversationReportView])
  items: ConversationReportView[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
