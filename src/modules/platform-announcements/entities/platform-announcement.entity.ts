import {
  Column,
  CreateDateColumn,
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
  AnnouncementStatus,
  AnnouncementTargetMode,
} from '../enums/platform-announcement.enums';

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
}
