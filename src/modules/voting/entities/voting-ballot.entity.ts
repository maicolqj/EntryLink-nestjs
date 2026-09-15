import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { VotingQuestion } from './voting-question.entity';
import { VotingOption } from './voting-option.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { User } from '../../users/entities/user.entity';

const numeric = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value == null ? null : Number(value)),
};

/**
 * Un voto emitido.
 *
 * No es un ObjectType a propósito: si la pregunta es secreta, nadie puede
 * consultar qué votó cada quien, y la única salida hacia la API son los
 * resultados que arma el servicio respetando esa reserva.
 *
 * `voterKey` es quien vota a efectos del conteo: `unit:<id>` en asamblea (vota
 * la unidad, no la persona) y `user:<id>` en el consejo. El índice único sobre
 * (pregunta, voterKey) es lo que garantiza un voto por unidad: dos residentes
 * del mismo apartamento votando a la vez no pueden pasar los dos.
 */
@Entity({ name: 'voting_ballots' })
@Index('UQ_voting_ballots_voter', ['questionId', 'voterKey'], { unique: true })
export class VotingBallot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => VotingQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question?: VotingQuestion;

  @Column({ name: 'option_id', type: 'uuid' })
  optionId: string;

  @ManyToOne(() => VotingOption, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'option_id' })
  option?: VotingOption;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Column({ name: 'voter_key', type: 'varchar', length: 60 })
  voterKey: string;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => Unit, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  /** Quién pulsó el botón. En asamblea es uno de los residentes de la unidad. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'resident_id', type: 'uuid', nullable: true })
  residentId?: string | null;

  /** Coeficiente de la unidad o 1, congelado al votar. */
  @Column({
    name: 'weight',
    type: 'numeric',
    precision: 14,
    scale: 6,
    transformer: numeric,
  })
  weight: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
