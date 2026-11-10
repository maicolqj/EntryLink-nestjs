import { InputType, Field } from '@nestjs/graphql';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

import { CallDirection } from '../../enums/call-direction.enum';
import { CallOutcome } from '../../enums/call-outcome.enum';
import { CallChannel } from '../../enums/call-channel.enum';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';

@InputType()
export class CallLogsInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  agentUserId?: string;

  @Field(() => CallDirection, { nullable: true })
  @IsOptional()
  @IsEnum(CallDirection)
  direction?: CallDirection;

  @Field(() => CallOutcome, { nullable: true })
  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @Field(() => CallChannel, {
    nullable: true,
    description: 'SIM o INTERNET. Sin filtro, las dos',
  })
  @IsOptional()
  @IsEnum(CallChannel)
  channel?: CallChannel;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @Field(() => PaginationInput, { nullable: true })
  @IsOptional()
  pagination?: PaginationInput;
}
