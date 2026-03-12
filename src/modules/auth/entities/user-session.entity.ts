import { Entity, PrimaryColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, Index, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum SessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  LOGGED_OUT = 'logged_out',
}

@Entity('user_sessions')
@Index(['userId', 'status'])
export class UserSession {
  @PrimaryColumn({ type: 'varchar', length: 64 }) // Cambiado de uuid a varchar
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 64 })
  deviceFingerprint: string;

  @Column({ type: 'jsonb' })
  deviceInfo: { userAgent: string; ip: string; platform: string; deviceId?: string; appVersion?: string };

  @Column({ type: 'enum', enum: SessionStatus, default: SessionStatus.ACTIVE })
  status: SessionStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastActivityAt: Date;

  @Column({ type: 'varchar', nullable: true })
  lastIp: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}