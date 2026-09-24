import { InputType, Field } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  MarketplaceChatReportAction,
  MarketplaceChatReportReason,
} from '../../enums/marketplace-chat-report-reason.enum';

@InputType()
export class ReportConversationInput {
  @Field(() => String)
  @IsUUID()
  conversationId: string;

  @Field(() => MarketplaceChatReportReason)
  @IsEnum(MarketplaceChatReportReason)
  reason: MarketplaceChatReportReason;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Además de reportar, bloquear al otro vecino',
  })
  @IsOptional()
  @IsBoolean()
  alsoBlock?: boolean;
}

@InputType()
export class ResolveConversationReportInput {
  @Field(() => String)
  @IsUUID()
  reportId: string;

  @Field(() => MarketplaceChatReportAction)
  @IsEnum(MarketplaceChatReportAction)
  action: MarketplaceChatReportAction;

  @Field(() => String, {
    nullable: true,
    description: 'Le llega a quien reportó',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
