import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tramo en el que un conjunto tuvo las automatizaciones pausadas por no
 * renovar. Se escribe al reanudar y no cambia después, salvo la marca de los
 * recurrentes: de aquí salen los días que no cuentan para la mora.
 *
 * El índice único impide registrar dos veces la misma pausa cuando dos
 * renovaciones llegan a la vez sobre el mismo vencimiento.
 */
@Entity({ name: 'subscription_pauses' })
@Index(['complexId', 'pausedAt'], { unique: true })
@Index(['complexId', 'resumedAt'])
export class SubscriptionPause {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Column({ name: 'paused_at', type: 'timestamptz' })
  pausedAt: Date;

  @Column({ name: 'resumed_at', type: 'timestamptz' })
  resumedAt: Date;

  @Column({ type: 'int' })
  days: number;

  /** Vacío hasta que el cron causa los recurrentes de esos días. */
  @Column({
    name: 'recurring_caught_up_at',
    type: 'timestamptz',
    nullable: true,
  })
  recurringCaughtUpAt: Date | null;
}
