import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { MarketplaceChatReportReason } from '../enums/marketplace-chat-report-reason.enum';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';

/**
 * Un vecino reportó una conversación del chat de clasificados.
 *
 * Es la única puerta por la que la administración lee un chat: sin reporte,
 * ningún moderador lo ve. Quién reportó lo sabe la administración, nunca el
 * reportado.
 */
@Entity({ name: 'marketplace_conversation_reports' })
@Index(['complexId', 'status', 'createdAt'])
export class MarketplaceConversationReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Column({ name: 'reporter_user_id', type: 'uuid' })
  reporterUserId: string;

  @Column({ name: 'reported_user_id', type: 'uuid' })
  reportedUserId: string;

  @Column({ type: 'varchar', length: 30 })
  reason: MarketplaceChatReportReason;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: MarketplaceReportStatus.PENDING,
  })
  status: MarketplaceReportStatus;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
