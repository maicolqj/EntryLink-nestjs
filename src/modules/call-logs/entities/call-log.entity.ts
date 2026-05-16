import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { User }               from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { CallDirection }      from '../enums/call-direction.enum';
import { CallOutcome }        from '../enums/call-outcome.enum';

@ObjectType({ description: 'Registro de llamada realizada o recibida por el guardia' })
@Entity({ name: 'call_logs' })
@Index(['complexId', 'startedAt'])
@Index(['agentUserId', 'startedAt'])
@Index(['complexId', 'outcome'])
export class CallLog {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== CLASIFICACIÓN ====================

  @Field(() => CallDirection)
  @Column({ type: 'varchar', length: 10 })
  direction: CallDirection;

  @Field(() => CallOutcome)
  @Column({ type: 'varchar', length: 10 })
  outcome: CallOutcome;

  @Field(() => String)
  @Column({ name: 'phone_number', type: 'varchar', length: 30 })
  phoneNumber: string;

  // ==================== AGENTE (guardia) ====================

  @Field(() => String)
  @Column({ name: 'agent_name', type: 'varchar', length: 200 })
  agentName: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'agent_user_id', type: 'uuid', nullable: true })
  agentUserId: string | null;

  // ==================== RESIDENTE (opcional) ====================

  @Field(() => String, { nullable: true })
  @Column({ name: 'resident_id', type: 'uuid', nullable: true })
  residentId: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'resident_name', type: 'varchar', length: 200, nullable: true })
  residentName: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'unit_number', type: 'varchar', length: 50, nullable: true })
  unitNumber: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'building_name', type: 'varchar', length: 100, nullable: true })
  buildingName: string | null;

  // ==================== TEMPORALIDAD ====================

  @Field(() => Date)
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Field(() => Int)
  @Column({ name: 'duration_seconds', type: 'int', default: 0 })
  durationSeconds: number;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // ==================== FKs (MULTI-TENANT) ====================

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { nullable: true, description: 'Guardia/agente que realizó o recibió la llamada' })
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'agent_user_id' })
  agent?: User;
}
