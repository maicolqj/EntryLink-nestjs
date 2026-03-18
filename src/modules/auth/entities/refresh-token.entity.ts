import { Entity, PrimaryColumn, Column, ManyToOne, CreateDateColumn, Index } from 'typeorm';
import { ObjectType, Field, ID, HideField } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';

// Definimos un tipo para el JSONB para que GraphQL sepa qué estructura esperar
@ObjectType()
class DeviceInfo {
  @Field() userAgent: string;
  @Field() ip: string;
  @Field() platform: string;
  @Field({ nullable: true }) deviceId?: string;
  @Field({ nullable: true }) appVersion?: string;
}

@ObjectType() // 1. Marcamos la clase como un tipo de objeto GraphQL
@Entity('refresh_tokens')
@Index(['userId', 'isRevoked'])
@Index(['tokenFamily'])
export class RefreshToken {
  @Field(() => ID) // 2. Mapeamos el ID a tipo ID de GraphQL
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Field() // 3. El userId suele ser útil en el frontend
  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Field(() => User) // 4. Relación expuesta en el grafo
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @HideField() // 5. SEGURIDAD: Nunca expongas hashes en el esquema GraphQL
  @Column({ type: 'text', unique: true })
  tokenHash: string;

  @Field()
  @Column({ type: 'text' })
  tokenFamily: string;

  @Field()
  @Column({ type: 'text' })
  sessionId: string;

  @Field()
  @Column({ type: 'text' })
  deviceFingerprint: string;

  @Field(() => DeviceInfo, { nullable: true }) // 6. Mapeo del objeto complejo
  @Column({ type: 'jsonb', nullable: true })
  deviceInfo: DeviceInfo;

  @Field()
  @Column({ type: 'boolean', default: false })
  isRevoked: boolean;

  @Field({ nullable: true })
  @Column({ type: 'varchar', nullable: true })
  revokedReason?: string;

  @Field()
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field({ nullable: true })
  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  replacedByTokenId?: string;
}