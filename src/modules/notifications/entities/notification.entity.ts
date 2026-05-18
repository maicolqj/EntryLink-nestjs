import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { NotificationType }          from '../enums/notification-type.enum';
import { NotificationPriority }      from '../enums/notification-priority.enum';
import { NotificationActionType }    from '../enums/notification-action-type.enum';
import { NotificationActionResult }  from '../enums/notification-action-result.enum';

/**
 * Notificación persistida en base de datos.
 *
 * Diseño multi-tenant:
 *  - complexId: siempre presente (la notificación pertenece a un complejo).
 *  - recipientUserId: el usuario que debe verla.  NULL = broadcast del complejo.
 *  - Si una notificación es para todos los residentes del complejo,
 *    se crea un registro por cada recipiente (fan-out al insertar).
 */
@ObjectType()
@Entity('notifications')
@Index(['recipientUserId', 'isRead'])
@Index(['complexId', 'createdAt'])
@Index(['recipientUserId', 'complexId', 'createdAt'])
export class Notification {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Tipo y prioridad ─────────────────────────────────────────

  @Field(() => NotificationType)
  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Field(() => NotificationPriority)
  @Column({ type: 'enum', enum: NotificationPriority, default: NotificationPriority.NORMAL })
  priority: NotificationPriority;

  // ─── Contenido ────────────────────────────────────────────────

  @Field()
  @Column()
  title: string;

  @Field()
  @Column({ type: 'text' })
  body: string;

  /**
   * Metadatos estructurados: { entityId, entityType, deepLink, ... }
   * Permite a la app navegar al recurso relacionado al tocar la notificación.
   */
  @Field(() => GraphQLJSON, { nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // ─── Broadcast ───────────────────────────────────────────────

  /** true = notificación masiva; recipientUserId es NULL en este caso */
  @Field()
  @Column({ default: false })
  isBroadcast: boolean;

  /** Roles destinatarios del broadcast (vacío = todos los usuarios del complejo) */
  @Field(() => [String], { nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  targetRoles?: string[];

  // ─── Estado de lectura ────────────────────────────────────────

  @Field()
  @Column({ default: false })
  isRead: boolean;

  @Field(() => Date, { nullable: true })
  @Column({ nullable: true })
  readAt?: Date;

  // ─── Destinatario ─────────────────────────────────────────────

  /** ID del usuario al que va dirigida. NULL cuando isBroadcast = true. */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  recipientUserId?: string;

  // ─── Multitenancy ─────────────────────────────────────────────

  @Field()
  @Column()
  complexId: string;

  // ─── Entidad relacionada (referencia débil, no FK) ────────────

  /** ID del recurso que originó la notificación (paquete, visita, vehículo...) */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  entityId?: string;

  /** Nombre de la tabla / módulo del recurso (para deep link) */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  entityType?: string;

  // ─── Trazabilidad — quién originó la notificación ────────────

  /**
   * ID del usuario (o entidad) que disparó la notificación.
   * NULL = generada por el sistema (cron, evento automático).
   */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  createdByUserId?: string;

  // ─── Acciones requeridas ──────────────────────────────────────

  /**
   * Indica si el destinatario debe tomar una acción (aprobar/rechazar/confirmar).
   * El frontend usa este flag para mostrar botones de acción en la tarjeta.
   */
  @Field()
  @Column({ default: false })
  isActionable: boolean;

  /** Tipo de acción esperada. Solo presente cuando isActionable = true. */
  @Field(() => NotificationActionType, { nullable: true })
  @Column({ type: 'enum', enum: NotificationActionType, nullable: true })
  actionType?: NotificationActionType;

  /** Etiqueta del botón principal de acción (p.ej. "Aprobar acceso"). */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  actionLabel?: string;

  /** Cuándo se ejecutó la acción. NULL = pendiente. */
  @Field(() => Date, { nullable: true, })
  @Column({ nullable: true })
  actionTakenAt?: Date;

  /** ID del usuario que ejecutó la acción. */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  actionTakenByUserId?: string;

  /** Resultado de la acción tomada. */
  @Field(() => NotificationActionResult, { nullable: true })
  @Column({ type: 'enum', enum: NotificationActionResult, nullable: true })
  actionResult?: NotificationActionResult;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
