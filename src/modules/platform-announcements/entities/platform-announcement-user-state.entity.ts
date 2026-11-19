import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PlatformAnnouncement } from './platform-announcement.entity';

/**
 * Marcas personales de cada miembro de la plataforma sobre un comunicado, como
 * en el correo: destacar y archivar no le cambian nada a los demás. Sin fila =
 * ni destacado ni archivado.
 */
@Entity('platform_announcement_user_states')
@Index(['announcementId', 'userId'], { unique: true })
@Index(['userId'])
export class PlatformAnnouncementUserState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'announcement_id', type: 'uuid' })
  announcementId: string;

  @ManyToOne(() => PlatformAnnouncement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'announcement_id' })
  announcement?: PlatformAnnouncement;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'is_starred', type: 'boolean', default: false })
  isStarred: boolean;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
