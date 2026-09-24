import { InputType, Field } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** "Me interesa": abre (o reabre) el chat con quien publicó. */
@InputType()
export class OpenListingConversationInput {
  @Field(() => String)
  @IsUUID()
  listingId: string;

  @Field(() => String, {
    nullable: true,
    description: 'Primer mensaje para quien publicó',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

@InputType()
export class SendMarketplaceMessageInput {
  @Field(() => String)
  @IsUUID()
  conversationId: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;
}
