import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { MarketplaceListing } from './marketplace-listing.entity';

/**
 * Conversación entre quien publicó un aviso y un vecino interesado.
 *
 * Hay una sola por aviso e interesado: tocar "me interesa" otra vez reabre la
 * misma. Los contadores de no leídos y el último mensaje se guardan aquí para
 * que la bandeja salga de una consulta, sin contar mensajes cada vez.
 *
 * No es un ObjectType: al cliente sale como `MarketplaceConversationView`, que
 * ya viene contada desde el lado de quien consulta (sus no leídos, el otro
 * vecino, si puede escribir).
 */
@Entity({ name: 'marketplace_conversations' })
@Index(['ownerUserId', 'lastMessageAt'])
@Index(['interestedUserId', 'lastMessageAt'])
export class MarketplaceConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'listing_id', type: 'uuid' })
  listingId: string;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @Column({ name: 'interested_user_id', type: 'uuid' })
  interestedUserId: string;

  /** Desde qué unidad preguntó. Se guarda: si se muda, el chat no cambia. */
  @Column({ name: 'interested_unit_id', type: 'uuid', nullable: true })
  interestedUnitId?: string | null;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt?: Date | null;

  @Column({
    name: 'last_message_preview',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  lastMessagePreview?: string | null;

  @Column({ name: 'last_message_sender_id', type: 'uuid', nullable: true })
  lastMessageSenderId?: string | null;

  @Column({ name: 'owner_unread_count', type: 'int', default: 0 })
  ownerUnreadCount: number;

  @Column({ name: 'interested_unread_count', type: 'int', default: 0 })
  interestedUnreadCount: number;

  @Column({ name: 'owner_last_read_at', type: 'timestamptz', nullable: true })
  ownerLastReadAt?: Date | null;

  @Column({
    name: 'interested_last_read_at',
    type: 'timestamptz',
    nullable: true,
  })
  interestedLastReadAt?: Date | null;

  /** Cuándo compartió su WhatsApp cada lado. Nulo = no lo ha compartido. */
  @Column({
    name: 'owner_phone_shared_at',
    type: 'timestamptz',
    nullable: true,
  })
  ownerPhoneSharedAt?: Date | null;

  @Column({
    name: 'interested_phone_shared_at',
    type: 'timestamptz',
    nullable: true,
  })
  interestedPhoneSharedAt?: Date | null;

  /** La administración la cerró al aceptar un reporte: solo lectura. */
  @Column({
    name: 'moderation_closed_at',
    type: 'timestamptz',
    nullable: true,
  })
  moderationClosedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => MarketplaceListing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing?: MarketplaceListing;
}
