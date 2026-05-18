import { ObjectType, Field, Int } from '@nestjs/graphql';
import { CallLog } from '../../entities/call-log.entity';

@ObjectType()
export class CallLogsPage {

  @Field(() => [CallLog])
  items: CallLog[];

  @Field(() => Int)
  totalItems: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;
}
