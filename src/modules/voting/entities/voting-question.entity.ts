import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { VoteSecrecy, VoteWeighting, VotingQuestionStatus } from '../enums/voting.enums';
import { VotingMeeting } from './voting-meeting.entity';
import { VotingOption } from './voting-option.entity';

/** Postgres devuelve `numeric` como texto; aquí vuelve a ser número. */
const numeric = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value == null ? null : Number(value)),
};

/**
 * Pregunta sometida a votación.
 *
 * El peso y la reserva del voto se eligen por pregunta y no por reunión: en la
 * misma asamblea se aprueba el presupuesto por coeficiente y se elige al
 * revisor fiscal con voto secreto.
 *
 * Solo se edita en borrador. Abierta ya recibe votos, y cambiarle el texto o
 * las opciones después cambiaría lo que alguien ya votó.
 */
@ObjectType({ description: 'Pregunta sometida a votación' })
@Entity({ name: 'voting_questions' })
@Index('IDX_voting_questions_meeting', ['meetingId'])
@Index('IDX_voting_questions_complex_status', ['complexId', 'status'])
export class VotingQuestion {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Field(() => VotingMeeting, { nullable: true })
  @ManyToOne(() => VotingMeeting, meeting => meeting.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting?: VotingMeeting;

  /** Orden dentro de la reunión, como se leen en el orden del día. */
  @Field(() => Int)
  @Column({ name: 'position', type: 'int', default: 0 })
  position: number;

  @Field(() => String)
  @Column({ name: 'text', type: 'varchar', length: 500 })
  text: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string | null;

  @Field(() => VoteWeighting)
  @Column({ name: 'weighting', type: 'varchar', length: 20 })
  weighting: VoteWeighting;

  @Field(() => VoteSecrecy)
  @Column({ name: 'secrecy', type: 'varchar', length: 20, default: VoteSecrecy.NOMINAL })
  secrecy: VoteSecrecy;

  @Field(() => VotingQuestionStatus)
  @Column({ name: 'status', type: 'varchar', length: 20, default: VotingQuestionStatus.DRAFT })
  status: VotingQuestionStatus;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  @Field(() => [VotingOption], { nullable: true })
  @OneToMany(() => VotingOption, option => option.question)
  options?: VotingOption[];

  /**
   * Quiénes podían votar al cerrarse: unidades, suma de coeficientes o
   * consejeros. Se congela al cerrar para que el porcentaje de participación
   * del acta no cambie si mañana se crea una unidad o se va un consejero.
   */
  @Column({ name: 'eligible_count', type: 'int', nullable: true })
  eligibleCount?: number | null;

  @Column({ name: 'eligible_weight', type: 'numeric', precision: 14, scale: 6, nullable: true, transformer: numeric })
  eligibleWeight?: number | null;

  // ─── Multi-tenant y auditoría ─────────────────────────────────────────────

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
