import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { User } from '../../users/entities/user.entity';
import {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementChannel,
  AnnouncementStatus,
  AnnouncementTargetMode,
} from '../enums/platform-announcement.enums';

/**
 * Archivo adjunto. La llave de R2 no tiene campo GraphQL a propósito: el
 * archivo no tiene URL pública y solo lo entrega el backend a quien recibió el
 * comunicado (`GET /platform-announcements/:id/attachments/:index`).
 */
@ObjectType()
export class AnnouncementAttachment {
  key: string;

  @Field()
  name: string;

  @Field()
  mimeType: string;

  @Field(() => Int)
  size: number;
}

/**
 * Comunicado que la plataforma (SUPER_ADMIN, oficial de cumplimiento) envía a
 * los conjuntos: novedades, promociones, noticias.
 *
 * Es el registro del envío; lo que ve cada destinatario es una notificación
 * PLATFORM_ANNOUNCEMENT que apunta aquí (`entityType = platform_announcement`),
 * y de aquí salen las imágenes cuando se abre el detalle. No cabe en
 * `notification_batches` porque un lote allí es de UN complejo.
 */
@ObjectType({ description: 'Comunicado de la plataforma a los conjuntos' })
@Entity('platform_announcements')
@Index(['createdAt'])
export class PlatformAnnouncement {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => AnnouncementCategory)
  @Column({ type: 'varchar', length: 20 })
  category: AnnouncementCategory;

  @Field()
  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Field()
  @Column({ type: 'text' })
  body: string;

  /** URLs públicas en R2, en el orden en que se muestran. */
  @Field(() => [String])
  @Column({ name: 'image_urls', type: 'jsonb', default: () => "'[]'" })
  imageUrls: string[];

  @Field(() => [AnnouncementAttachment])
  @Column({ type: 'jsonb', default: () => "'[]'" })
  attachments: AnnouncementAttachment[];

  @Field(() => [AnnouncementChannel])
  @Column({ type: 'jsonb', default: () => `'["NOTIFICATION"]'` })
  channels: AnnouncementChannel[];

  @Field(() => AnnouncementAudience)
  @Column({ type: 'varchar', length: 20 })
  audience: AnnouncementAudience;

  // ── Segmentación (lo que se pidió, tal cual) ───────────────────

  @Field(() => AnnouncementTargetMode)
  @Column({ name: 'target_mode', type: 'varchar', length: 20 })
  targetMode: AnnouncementTargetMode;

  /** Snapshot de los conjuntos resueltos al enviar, no solo los elegidos. */
  @Field(() => [String])
  @Column({ name: 'complex_ids', type: 'jsonb', default: () => "'[]'" })
  complexIds: string[];

  @Field(() => [String])
  @Column({ name: 'target_plans', type: 'jsonb', default: () => "'[]'" })
  targetPlans: string[];

  @Field(() => [String])
  @Column({ name: 'target_statuses', type: 'jsonb', default: () => "'[]'" })
  targetStatuses: string[];

  @Field(() => [String])
  @Column({ name: 'target_engagements', type: 'jsonb', default: () => "'[]'" })
  targetEngagements: string[];

  // ── Resultado del reparto ─────────────────────────────────────

  @Field(() => AnnouncementStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: AnnouncementStatus.SENDING,
  })
  status: AnnouncementStatus;

  @Field(() => Int)
  @Column({ name: 'complexes_count', type: 'int', default: 0 })
  complexesCount: number;

  /** Avisos creados. Se completa al terminar el reparto. */
  @Field(() => Int)
  @Column({ name: 'recipients_count', type: 'int', default: 0 })
  recipientsCount: number;

  /**
   * Correos puestos en la cola (uno por conjunto con email registrado). Que
   * estén en la cola no quiere decir que se hayan entregado: los fallos del
   * SMTP quedan en el log y en Bull Board.
   */
  @Field(() => Int)
  @Column({ name: 'emails_count', type: 'int', default: 0 })
  emailsCount: number;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null;

  // ── Auditoría ─────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy?: User;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ── Papelera ──────────────────────────────────────────────────

  /** En la papelera desde esta fecha; a los 30 días se elimina del todo. */
  @Field(() => Date, { nullable: true })
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;

  @Column({ name: 'deleted_by_user_id', type: 'uuid', nullable: true })
  deletedByUserId?: string | null;

  // ── Marcas de quien consulta (no son columnas) ────────────────

  /** Destacado por quien consulta. Lo llena el servicio. */
  @Field(() => Boolean)
  isStarred = false;

  /** Archivado por quien consulta. Lo llena el servicio. */
  @Field(() => Boolean)
  isArchived = false;
}
