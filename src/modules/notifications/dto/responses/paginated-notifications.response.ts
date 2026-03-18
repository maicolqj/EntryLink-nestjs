import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Notification } from '../../entities/notification.entity';

@ObjectType()
export class PaginatedNotificationsResponse {

  @Field(() => [Notification])
  items: Notification[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
