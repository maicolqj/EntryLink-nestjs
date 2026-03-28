import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { NotificationType }     from '../enums/notification-type.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';
import { User }                  from '../../users/entities/user.entity';

/**
 * Registro histórico de cada envío masivo manual disparado desde
 * la mutación sendNotification. Las notificaciones automáticas del
 * sistema (paquetes, parqueo, etc.) NO generan fila aquí.
 */
@ObjectType({ description: 'Envío masivo de notificación registrado por un administrador' })
@Entity('notification_batches')
@Index(['senderId', 'complexId', 'createdAt'])
@Index(['complexId', 'createdAt'])
export class NotificationBatch {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Quién envió ────────────────────────────────────────────

  /**
   * ID del usuario que disparó el envío.
   * Null cuando el envío lo realizó un COMPLEX_ROL (cuyo sub en JWT es el ID del complejo, no un User).
   */
  @Field(() => String, { nullable: true, description: 'ID del usuario que disparó el envío' })
  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId: string | null;

  @Field(() => User, { nullable: true, description: 'Usuario que disparó el envío' })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'sender_id' })
  sender?: User;

  // ── Tenant ─────────────────────────────────────────────────

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ── Contenido del mensaje ──────────────────────────────────

  @Field(() => NotificationType)
  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Field(() => NotificationPriority)
  @Column({ type: 'enum', enum: NotificationPriority, default: NotificationPriority.NORMAL })
  priority: NotificationPriority;

  @Field()
  @Column()
  title: string;

  @Field()
  @Column({ type: 'text' })
  body: string;

  // ── Segmentación ───────────────────────────────────────────

  /**
   * Roles destinatarios al momento del envío.
   * Array vacío [] = "todos los usuarios del complejo".
   * Es un snapshot histórico — no recalcular.
   */
  @Field(() => [String], { nullable: true })
  @Column({ name: 'target_roles', type: 'jsonb', default: [] })
  targetRoles: string[];

  /** Total de destinatarios resueltos al momento del envío (snapshot histórico). */
  @Field(() => Int)
  @Column({ name: 'recipients_count', type: 'int' })
  recipientsCount: number;

  // ── Auditoría ──────────────────────────────────────────────

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
