import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Aviso de vencimiento ya enviado.
 *
 * El índice único (complejo, vencimiento, hito) es lo que impide que un
 * reinicio del servidor o dos réplicas corriendo el cron a la vez manden el
 * mismo aviso dos veces. Va atado al vencimiento y no al periodo: si el
 * SUPER_ADMIN corre la fecha, los avisos vuelven a empezar para la fecha nueva.
 */
@Entity({ name: 'subscription_reminders' })
@Index(['complexId', 'endsAt', 'milestone'], { unique: true })
export class SubscriptionReminder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  /** D15 | D7 | D3 | D1 | EXPIRED | SUSPENDED */
  @Column({ type: 'varchar', length: 20 })
  milestone: string;

  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;
}
