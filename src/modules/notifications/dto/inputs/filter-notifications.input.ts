import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsEnum, IsBoolean } from 'class-validator';

import { NotificationType }     from '../../enums/notification-type.enum';
import { NotificationPriority } from '../../enums/notification-priority.enum';

@InputType()
export class FilterNotificationsInput {

  @Field(() => NotificationType, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @Field(() => NotificationPriority, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  /** Si `true`, devuelve sólo las no leídas. Si `false`, sólo las leídas. Omitir = todas. */
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isRead?: boolean;
}
