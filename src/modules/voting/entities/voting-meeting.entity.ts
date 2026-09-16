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
import { ObjectType, Field } from '@nestjs/graphql';

import { VotingMeetingKind } from '../enums/voting.enums';
import { VotingQuestion } from './voting-question.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Reunión en la que se vota: una asamblea de copropietarios o una sesión del
 * consejo. Agrupa las preguntas para que el acta de cada reunión salga junta.
 *
 * `kind` no es informativo: en una asamblea vota una persona por unidad; en el
 * consejo, cada consejero. Las reuniones del consejo no le aparecen al resto
 * de residentes.
 */
@ObjectType({ description: 'Reunión en la que se vota: asamblea o consejo' })
@Entity({ name: 'voting_meetings' })
@Index('IDX_voting_meetings_complex_kind', ['complexId', 'kind'])
export class VotingMeeting {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => VotingMeetingKind)
  @Column({ name: 'kind', type: 'varchar', length: 20 })
  kind: VotingMeetingKind;

  @Field(() => String)
  @Column({ name: 'title', type: 'varchar', length: 200 })
  title: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string | null;

  @Field(() => Date)
  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Field(() => [VotingQuestion], { nullable: true })
  @OneToMany(() => VotingQuestion, (question) => question.meeting)
  questions?: VotingQuestion[];

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  // ─── Multi-tenant y auditoría ─────────────────────────────────────────────

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @ManyToOne(() => ResidentialComplex, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
