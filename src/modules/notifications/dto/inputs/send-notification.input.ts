import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, IsUUID } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

import { NotificationType }     from '../../enums/notification-type.enum';
import { NotificationPriority } from '../../enums/notification-priority.enum';

/**
 * Input para enviar una notificación masiva desde el panel de administración.
 * Disponible solo para SUPER_ADMIN_ROL, COMPLEX_ROL y SUPERVISOR_ROL.
 */
@InputType()
export class SendNotificationInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  title: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  body: string;

  @Field(() => NotificationType, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @Field(() => NotificationPriority, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  /**
   * Roles destinatarios.
   * Si se omite o queda vacío, se notifica a TODOS los usuarios del complejo.
   */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetRoles?: string[];

  /**
   * Unidad específica destinataria.
   * Si se especifica, solo se notifica a los residentes de esa unidad.
   */
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  targetUnitId?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  metadata?: Record<string, any>;
}
