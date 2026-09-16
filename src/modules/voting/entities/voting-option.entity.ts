import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { VotingQuestion } from './voting-question.entity';

/** Opción de respuesta de una pregunta: "Sí", "No", "Me abstengo", un candidato... */
@ObjectType({ description: 'Opción de respuesta de una pregunta' })
@Entity({ name: 'voting_options' })
@Index('IDX_voting_options_question', ['questionId'])
export class VotingOption {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => VotingQuestion, (question) => question.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question?: VotingQuestion;

  @Field(() => Int)
  @Column({ name: 'position', type: 'int', default: 0 })
  position: number;

  @Field(() => String)
  @Column({ name: 'text', type: 'varchar', length: 200 })
  text: string;
}
