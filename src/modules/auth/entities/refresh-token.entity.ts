// modules/auth/entities/refresh-token.entity.ts
import { Entity, PrimaryColumn, Column, ManyToOne, CreateDateColumn, Index, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
@Index(['userId', 'isRevoked'])
@Index(['tokenFamily'])
export class RefreshToken {
  @PrimaryColumn({ type: 'varchar', length: 64 }) // Cambiado de uuid a varchar
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  @Column({ type: 'varchar', length: 64 })
  tokenFamily: string;

  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 64 })
  deviceFingerprint: string;

  @Column({ type: 'jsonb', nullable: true })
  deviceInfo: { userAgent: string; ip: string; platform: string; deviceId?: string; appVersion?: string };

  @Column({ type: 'boolean', default: false })
  isRevoked: boolean;

  @Column({ type: 'varchar', nullable: true })
  revokedReason?: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  replacedByTokenId?: string;
}