import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Un vecino que bloqueó a otro en el chat de clasificados.
 *
 * Corta los mensajes en las dos direcciones. Quien quedó bloqueado no se
 * entera de que lo bloquearon: solo ve que no puede escribir.
 */
@Entity({ name: 'marketplace_user_blocks' })
export class MarketplaceUserBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'blocker_user_id', type: 'uuid' })
  blockerUserId: string;

  @Column({ name: 'blocked_user_id', type: 'uuid' })
  blockedUserId: string;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
