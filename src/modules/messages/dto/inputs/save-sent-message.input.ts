import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsInt,
  Min,
  IsArray,
  ArrayNotEmpty,
  MaxLength,
} from 'class-validator';

import { MessageChannel } from '../../enums/message-channel.enum';
import { MessageType }    from '../../enums/message-type.enum';

@InputType()
export class SaveSentMessageInput {

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  unitId: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unitNumber: string;

  @Field(() => MessageChannel)
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @Field(() => MessageType)
  @IsEnum(MessageType)
  messageType: MessageType;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  body: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  recipientCount: number;

  @Field(() => [String])
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  recipientPhones: string[];
}
