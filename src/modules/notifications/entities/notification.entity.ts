import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { NotificationType }     from '../enums/notification-type.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';

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
  @Field(() => String, { nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // ─── Estado de lectura ────────────────────────────────────────

  @Field()
  @Column({ default: false })
  isRead: boolean;

  @Field(() => Date, { nullable: true })
  @Column({ nullable: true })
  readAt?: Date;

  // ─── Destinatario ─────────────────────────────────────────────

  /** ID del usuario al que va dirigida. NULL = broadcast. */
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

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
