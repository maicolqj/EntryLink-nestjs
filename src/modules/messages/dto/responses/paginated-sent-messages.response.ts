import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { SentMessage }       from '../../entities/sent-message.entity';

@ObjectType()
export class PaginatedSentMessagesResponse {

  @Field(() => [SentMessage])
  items: SentMessage[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
