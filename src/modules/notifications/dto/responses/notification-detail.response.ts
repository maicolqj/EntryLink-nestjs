import { ObjectType, Field, ID } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { NotificationType }         from '../../enums/notification-type.enum';
import { NotificationPriority }     from '../../enums/notification-priority.enum';
import { NotificationActionType }   from '../../enums/notification-action-type.enum';
import { NotificationActionResult } from '../../enums/notification-action-result.enum';

/**
 * Información del usuario relacionado a la notificación
 * (creador, destinatario o quien ejecutó la acción).
 */
@ObjectType()
export class NotificationUserInfo {

  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  lastName: string;

  /** Nombre completo: name + lastName */
  @Field()
  fullName: string;

  @Field()
  email: string;

  @Field(() => String, { nullable: true })
  phoneNumber?: string;

  /** Número de documento de identidad */
  @Field(() => String, { nullable: true })
  identity?: string;

  @Field(() => String, { nullable: true })
  profilePicture?: string;

  /** Roles asignados al usuario (nombres legibles). */
  @Field(() => [String])
  roles: string[];
}

/**
 * Detalle completo de una notificación.
 * Incluye información enriquecida del creador y del destinatario.
 */
@ObjectType()
export class NotificationDetailResponse {

  @Field(() => ID)
  id: string;

  // ─── Tipo y prioridad ─────────────────────────────────────────

  @Field(() => NotificationType)
  type: NotificationType;

  @Field(() => NotificationPriority)
  priority: NotificationPriority;

  // ─── Contenido ────────────────────────────────────────────────

  @Field()
  title: string;

  @Field()
  body: string;

  @Field(() => GraphQLJSON, { nullable: true })
  metadata?: Record<string, any>;

  // ─── Broadcast ───────────────────────────────────────────────

  @Field()
  isBroadcast: boolean;

  @Field(() => [String], { nullable: true })
  targetRoles?: string[];

  // ─── Estado de lectura ────────────────────────────────────────

  @Field()
  isRead: boolean;

  @Field(() => Date, { nullable: true })
  readAt?: Date;

  // ─── Destinatario ─────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  recipientUserId?: string;

  /** Datos completos del destinatario. NULL si el userId no existe en la BD. */
  @Field(() => NotificationUserInfo, { nullable: true })
  recipientUser?: NotificationUserInfo;

  // ─── Multitenancy ─────────────────────────────────────────────

  @Field()
  complexId: string;

  // ─── Entidad relacionada ──────────────────────────────────────

  @Field(() => String, { nullable: true })
  entityId?: string;

  @Field(() => String, { nullable: true })
  entityType?: string;

  // ─── Trazabilidad ─────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  createdByUserId?: string;

  /** Datos completos del usuario que originó la notificación. */
  @Field(() => NotificationUserInfo, { nullable: true })
  createdByUser?: NotificationUserInfo;

  // ─── Acciones requeridas ──────────────────────────────────────

  @Field()
  isActionable: boolean;

  @Field(() => NotificationActionType, { nullable: true })
  actionType?: NotificationActionType;

  @Field(() => String, { nullable: true })
  actionLabel?: string;

  @Field(() => Date, { nullable: true })
  actionTakenAt?: Date;

  @Field(() => String, { nullable: true })
  actionTakenByUserId?: string;

  /** Datos del usuario que ejecutó la acción. */
  @Field(() => NotificationUserInfo, { nullable: true })
  actionTakenByUser?: NotificationUserInfo;

  @Field(() => NotificationActionResult, { nullable: true })
  actionResult?: NotificationActionResult;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
