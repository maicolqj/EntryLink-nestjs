import { InputType, Field } from '@nestjs/graphql';
import {
  IsOptional,
  IsEnum,
  IsBoolean,
  IsString,
  MaxLength,
} from 'class-validator';

import { NotificationType } from '../../enums/notification-type.enum';
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

  /** Si `true`, sólo las destacadas por el propio usuario. Omitir = todas. */
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isStarred?: boolean;

  /**
   * Busca en título y cuerpo, sin distinguir mayúsculas ni acentos de más.
   *
   * Filtra en el SERVIDOR y no en la página cargada: un buzón con seiscientos
   * avisos paginado de quince en quince haría que "buscar" solo mirara los
   * quince que se están viendo, que es justo cuando no sirve.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
