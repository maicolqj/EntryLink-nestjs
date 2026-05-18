import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { NotificationType }     from '../../enums/notification-type.enum';
import { NotificationPriority } from '../../enums/notification-priority.enum';
import { PaginationReponse }    from '../../../shared/dto/responses/pagination-object.response';

@ObjectType({ description: 'Notificación masiva enviada por el administrador' })
export class SentNotification {

  @Field(() => ID)
  id: string;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field(() => NotificationPriority)
  priority: NotificationPriority;

  @Field()
  title: string;

  @Field()
  body: string;

  @Field(() => Int, { description: 'Total de destinatarios al momento del envío' })
  recipientsCount: number;

  @Field(() => [String], { nullable: true, description: 'Roles destinatarios. Vacío = todos los usuarios.' })
  targetRoles?: string[];

  @Field()
  createdAt: Date;
}

@ObjectType()
export class SentNotificationPaginatedResult {
  @Field(() => [SentNotification])
  items: SentNotification[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
